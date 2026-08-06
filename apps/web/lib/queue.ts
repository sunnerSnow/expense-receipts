import "server-only";
import PgBoss from "pg-boss";
import {
  QUEUES,
  RECOGNIZE_RETRY_OPTIONS,
  type GenerateExportPayload,
  type RecognizeReceiptPayload,
} from "@expense-receipts/queue";
import { env } from "./env";

/**
 * web 端只負責派工(send),不跑任何 worker —— 所以關掉 supervise / schedule,
 * 避免 Next.js 程序裡多出維護排程與過期檢查的背景輪詢。
 *
 * 單例用 promise 快取:並行的 server action 共用同一次 start()。
 */
let _boss: Promise<PgBoss> | undefined;

function getBoss(): Promise<PgBoss> {
  if (!_boss) {
    _boss = (async () => {
      const boss = new PgBoss({
        connectionString: env.DATABASE_URL,
        supervise: false,
        schedule: false,
      });
      boss.on("error", (err) => console.error("[pg-boss:web]", err));
      await boss.start();
      // pg-boss 10 要求佇列先存在才能 send;worker 也會建,這裡是冪等的
      await boss.createQueue(QUEUES.recognizeReceipt);
      await boss.createQueue(QUEUES.generateExport);
      return boss;
    })().catch((err) => {
      // 失敗不要留下壞掉的快取,下次呼叫可以重試
      _boss = undefined;
      throw err;
    });
  }
  return _boss;
}

/** 派送 AI 辨識工作;回傳 job id */
export async function sendRecognizeJob(payload: RecognizeReceiptPayload): Promise<string> {
  const boss = await getBoss();
  const jobId = await boss.send(QUEUES.recognizeReceipt, payload, { ...RECOGNIZE_RETRY_OPTIONS });
  if (!jobId) throw new Error("辨識工作派送失敗(pg-boss 未回傳 job id)");
  return jobId;
}

/**
 * 派送月結匯出工作;回傳 job id。
 *
 * singletonKey 帶期間字串,但**別把防重複的責任押在它身上**:pg-boss 10 的
 * singletonKey 只在佇列 policy 是 short/singleton/stately 時才有唯一索引撐腰,
 * 我們用的是預設的 standard —— 連點兩次會真的產生兩份工作。
 *
 * 真正擋住重複匯出的是資料庫:撈取條件含 `export_batch_id IS NULL`,而狀態
 * 轉換的 UPDATE 以 `status = 'confirmed'` 為條件並比對更新筆數,先跑完的交易
 * 會讓後跑的那筆更新到 0 列而整批回滾(見 generate-export.ts)。
 * 這裡留 singletonKey 是為了日後改 policy 時能直接生效。
 */
export async function sendExportJob(payload: GenerateExportPayload): Promise<string> {
  const boss = await getBoss();
  const period = `${payload.periodYear}-${String(payload.periodMonth).padStart(2, "0")}`;
  const jobId = await boss.send(QUEUES.generateExport, payload, {
    singletonKey: `export:${period}`,
    retryLimit: 0,
  });
  if (!jobId) throw new Error(`${period} 已有一份匯出工作在進行中,請稍候`);
  return jobId;
}
