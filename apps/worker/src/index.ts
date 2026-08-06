import PgBoss from "pg-boss";
import { createDb } from "@expense-receipts/db";
import {
  QUEUES,
  RECOGNIZE_RETRY_OPTIONS,
  type GenerateExportPayload,
  type RecognizeReceiptPayload,
} from "@expense-receipts/queue";
import { env } from "./env";
import { generateExportJob } from "./jobs/generate-export";
import { recoverLostRecognitions } from "./jobs/recover-recognitions";
import { markRecognitionFailed, recognizeReceiptJob } from "./jobs/recognize-receipt";
import { createRecognizer } from "./recognizer";

async function main() {
  const db = createDb(env.DATABASE_URL);
  const recognizer = createRecognizer();

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

  console.log(`worker 已啟動(辨識器:${recognizer.id}),等待任務中`);

  const shutdown = async () => {
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
