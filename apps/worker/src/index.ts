import PgBoss from "pg-boss";
import { createDb } from "@expense-receipts/db";
import { QUEUES, type RecognizeReceiptPayload } from "@expense-receipts/queue";
import { env } from "./env";
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

  await boss.work(QUEUES.generateExport, async ([job]) => {
    // Phase 3:撈該期間 confirmed 單據 → 產出 CSV/Excel + 影像打包 → 更新 export_batches 與單據狀態
    console.log(`[${QUEUES.generateExport}] 收到 job`, job?.id, "(Phase 3 實作)");
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
