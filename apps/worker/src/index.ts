import PgBoss from "pg-boss";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@expense-receipts/db";
import { createAiReceiptRecord, receiptExists, type IntakeDeps } from "@expense-receipts/intake";
import {
  QUEUES,
  RECOGNIZE_RETRY_OPTIONS,
  type GenerateExportPayload,
  type RecognizeReceiptPayload,
} from "@expense-receipts/queue";
import { env } from "./env";
import { generateExportJob } from "./jobs/generate-export";
import { httpRelayClient, pullFromRelay } from "./jobs/pull-relay";
import { recoverLostRecognitions } from "./jobs/recover-recognitions";
import { markRecognitionFailed, recognizeReceiptJob } from "./jobs/recognize-receipt";
import { createRecognizer } from "./recognizer";

/** 等資料庫可用才往下走;回傳等待秒數 */
async function waitForDatabase(db: Db, timeoutMs = 120_000): Promise<number> {
  /*
    為什麼要等:開機自動啟動時,worker 幾乎一定比 Docker Desktop 裡的 Postgres
    早一步就緒。直接連會失敗、程序退出,使用者看到的是「worker 沒起來」而且
    沒有明顯原因 —— 但其實只要晚十秒就好。
  */
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let announced = false;

  for (;;) {
    try {
      await db.execute(sql`select 1`);
      return Math.round((Date.now() - startedAt) / 1000);
    } catch (err) {
      if (Date.now() >= deadline) {
        throw new Error(
          `等不到資料庫(已等 ${Math.round(timeoutMs / 1000)} 秒):${
            (err as Error)?.message ?? "未知錯誤"
          }`,
        );
      }
      if (!announced) {
        console.log("[啟動] 資料庫還沒就緒,等待中…");
        announced = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/**
 * 每 5 分鐘拉一次 = 每天 288 次 list,在 KV 免費方案每天 1,000 次 list 之內。
 * 實際上「要用才開電腦」,開機那一次才是主要的一輪;定時拉是給
 * 「電腦開著、手機沒連 Tailscale」的情況用的。
 */
const RELAY_PULL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 定時從雲端中繼站把照片拉回來建單(ADR-0009)。啟動時拉一次,之後定時拉。
 * 回傳停止函式,關機時先停掉再關 pg-boss。
 *
 * 不重疊:上一輪還沒跑完(例如慢速網路在下載大照片)就跳過這一輪 ——
 * 兩輪同時拉同一件雖然有主鍵擋著,但沒必要讓它發生。
 */
function startRelayPulling(boss: PgBoss, db: Db, relayUrl: string): () => void {
  // 建單走與 web 同一份 intake,只是換成 worker 自己的連線與 pg-boss
  const intake: IntakeDeps = {
    db,
    uploadDir: env.UPLOAD_DIR,
    sendRecognizeJob: async (payload) => {
      const jobId = await boss.send(QUEUES.recognizeReceipt, payload, { ...RECOGNIZE_RETRY_OPTIONS });
      if (!jobId) throw new Error("辨識工作派送失敗(pg-boss 未回傳 job id)");
    },
  };
  const client = httpRelayClient(relayUrl, env.RELAY_PULL_TOKEN);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await pullFromRelay({
        client,
        receiptExists: (id) => receiptExists(db, id),
        createReceipt: (input) => createAiReceiptRecord(intake, input),
      });
      if (summary.imported.length > 0) {
        console.log(
          `[中繼站] 拉回 ${summary.imported.length} 筆,已派 AI 辨識:${summary.imported.join(", ")}`,
        );
      }
      if (summary.duplicates.length > 0) {
        console.log(`[中繼站] ${summary.duplicates.length} 筆本機已有,已從中繼站刪除`);
      }
      // 留在中繼站的件代表需要人看(例如經手人對不到帳號),每一輪都提醒
      for (const left of summary.left) {
        console.warn(`[中繼站] ${left.id} 留在中繼站沒動:${left.reason}`);
      }
    } catch (err) {
      // 連不到中繼站(沒網路、Cloudflare 有狀況):下一輪再試,不讓 worker 掛掉
      console.warn(
        `[中繼站] 這一輪拉取失敗,${RELAY_PULL_INTERVAL_MS / 60_000} 分鐘後再試:${
          (err as Error)?.message ?? "未知錯誤"
        }`,
      );
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), RELAY_PULL_INTERVAL_MS);
  return () => clearInterval(timer);
}

async function main() {
  const db = createDb(env.DATABASE_URL);
  const recognizer = createRecognizer();

  const waited = await waitForDatabase(db);
  if (waited > 0) console.log(`[啟動] 資料庫已就緒(等了 ${waited} 秒)`);

  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();

  await boss.createQueue(QUEUES.recognizeReceipt);
  await boss.createQueue(QUEUES.generateExport);

  /*
    先救援再開工:機器關著的期間,佇列裡的工作可能已經過期被清掉
    (pg-boss 預設保留 14 天),單據就會永遠停在「辨識中」。
    掃描要在 boss.work() 之前,確保掃的時候沒有工作正在跑。
    這一步失敗不該擋住 worker 啟動 —— 記錄下來,照常開工。
  */
  try {
    const recovery = await recoverLostRecognitions({
      db,
      send: async (receiptId) => {
        await boss.send(QUEUES.recognizeReceipt, { receiptId } satisfies RecognizeReceiptPayload, {
          ...RECOGNIZE_RETRY_OPTIONS,
        });
      },
    });
    if (recovery.requeued.length > 0) {
      console.warn(
        `[啟動修復] ${recovery.queued} 筆掛在辨識中,其中 ${recovery.requeued.length} 筆找不到對應工作,已重新派工:${recovery.requeued.join(", ")}`,
      );
    } else if (recovery.queued > 0) {
      console.log(`[啟動修復] ${recovery.queued} 筆掛在辨識中,工作都還在佇列裡,不介入`);
    }
  } catch (err) {
    console.error(`[啟動修復] 掃描失敗,略過:${(err as Error)?.message ?? "未知錯誤"}`);
  }

  await boss.work<RecognizeReceiptPayload>(
    QUEUES.recognizeReceipt,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return;
      const { receiptId } = job.data;
      const lastAttempt = job.retryCount >= job.retryLimit;

      try {
        const outcome = await recognizeReceiptJob({ db, recognizer, payload: job.data });

        switch (outcome.kind) {
          case "done":
            console.log(`[辨識] ${receiptId} 完成,待人工確認`);
            return;
          case "skipped":
            console.log(`[辨識] ${receiptId} 略過:${outcome.reason}`);
            return;
          case "failed":
            console.warn(`[辨識] ${receiptId} 失敗:${outcome.error}`);
            return;
          case "transient":
            // 還有重試機會就交回 pg-boss 退避重試(單據維持 queued)
            if (!lastAttempt) throw new Error(outcome.error);
            console.error(`[辨識] ${receiptId} 重試用盡:${outcome.error}`);
            await markRecognitionFailed(db, receiptId, `${outcome.error}(已重試 ${job.retryCount} 次)`);
            return;
        }
      } catch (err) {
        // 非預期的例外(DB 約束、程式錯誤…):重試用盡後一定要寫回 DB,
        // 否則單據會永遠停在「辨識中」,使用者看不到任何原因也無法處理。
        if (!lastAttempt) throw err;
        const message = (err as Error)?.message ?? "未知錯誤";
        console.error(`[辨識] ${receiptId} 未預期錯誤(重試用盡):${message}`);
        await markRecognitionFailed(db, receiptId, `辨識時發生未預期錯誤:${message}`);
      }
    },
  );

  await boss.work<GenerateExportPayload>(QUEUES.generateExport, async ([job]) => {
    if (!job) return;
    const { periodYear, periodMonth } = job.data;
    const period = `${periodYear}-${String(periodMonth).padStart(2, "0")}`;

    const outcome = await generateExportJob({ db, payload: job.data });
    switch (outcome.kind) {
      case "done":
        console.log(
          `[匯出] ${period} 完成:${outcome.count} 筆 → ${outcome.csvPath}` +
            (outcome.zipPath ? ` + ${outcome.zipPath}` : "(無影像,未產 zip)"),
        );
        return;
      case "empty":
        console.log(`[匯出] ${period} 沒有可匯出的單據(需為已確認且未匯出)`);
        return;
      case "conflict":
        // 丟出去讓 pg-boss 記錄失敗;狀態衝突重跑通常就好了
        throw new Error(outcome.message);
    }
  });

  // 要在 boss.work() 之後:拉回的件會立刻派辨識工作,worker 得已經在接工作了
  const stopRelayPulling = env.RELAY_URL ? startRelayPulling(boss, db, env.RELAY_URL) : () => {};

  console.log(
    `worker 已啟動(辨識器:${recognizer.id};雲端中繼站:${env.RELAY_URL ? "每 5 分鐘拉取" : "未設定"}),等待任務中`,
  );

  const shutdown = async () => {
    stopRelayPulling();
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
