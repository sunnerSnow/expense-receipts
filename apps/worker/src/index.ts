import PgBoss from "pg-boss";
import { env } from "./env";

/** 佇列名稱:web 端 send、worker 端 work 都用這裡的常數,不得散落字串 */
export const QUEUES = {
  /** Phase 2:AI 辨識單據影像(payload: { receiptId: string }) */
  recognizeReceipt: "receipt.recognize",
  /** Phase 3:產生月結匯出檔(payload: { exportBatchId: string }) */
  generateExport: "export.generate",
} as const;

async function main() {
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();

  await boss.createQueue(QUEUES.recognizeReceipt);
  await boss.createQueue(QUEUES.generateExport);

  await boss.work(QUEUES.recognizeReceipt, async ([job]) => {
    // Phase 2:讀取單據影像 → Claude API vision + structured outputs → 寫回 receipts(status 維持 pending_review)
    console.log(`[${QUEUES.recognizeReceipt}] 收到 job`, job?.id, "(Phase 2 實作)");
  });

  await boss.work(QUEUES.generateExport, async ([job]) => {
    // Phase 3:撈該期間 confirmed 單據 → 產出 CSV/Excel + 影像打包 → 更新 export_batches 與單據狀態
    console.log(`[${QUEUES.generateExport}] 收到 job`, job?.id, "(Phase 3 實作)");
  });

  console.log("worker 已啟動,等待任務中");

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
