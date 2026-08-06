import { asc, eq, sql } from "drizzle-orm";
import { receipts, type Db } from "@expense-receipts/db";
import { selectLostRecognitions } from "@expense-receipts/core";
import { QUEUES } from "@expense-receipts/queue";

export interface RecoveryOutcome {
  /** 目前掛在「辨識中」的單據數 */
  queued: number;
  /** 這次重新派工的單據 id */
  requeued: string[];
}

/**
 * worker 啟動時把「卡在辨識中但佇列裡已經沒有工作」的單據重新派工。
 *
 * 這是「要用才開電腦」模式的配套:機器關著的期間工作可能過期被清掉
 * (pg-boss 預設保留 14 天),單據就會永遠停在「辨識中」。詳見 core 的
 * `selectLostRecognitions`。
 *
 * 必須在 `boss.work()` 註冊之前呼叫 —— 掃描期間不能有工作正在跑,
 * 否則讀到的快照會與實際狀態對不上。
 */
export async function recoverLostRecognitions(deps: {
  db: Db;
  send: (receiptId: string) => Promise<void>;
  now?: Date;
}): Promise<RecoveryOutcome> {
  const { db, send } = deps;

  const queued = await db
    .select({ receiptId: receipts.id, updatedAt: receipts.updatedAt })
    .from(receipts)
    .where(eq(receipts.recognitionStatus, "queued"))
    .orderBy(asc(receipts.updatedAt));

  if (queued.length === 0) return { queued: 0, requeued: [] };

  /*
    直接查 pg-boss 的工作表。

    為什麼要碰它的表:pg-boss 沒有「用 payload 反查工作」的公開 API,而少了
    這個判斷就只能盲目重派 —— 每開一次機就替同一張單據多疊一份工作,還會
    重複燒 API 額度。這裡只讀不寫,而且 `pgboss.job` 是它的公開 schema。
  */
  const live = await db.execute<{ receipt_id: string | null }>(sql`
    select distinct data->>'receiptId' as receipt_id
      from pgboss.job
     where name = ${QUEUES.recognizeReceipt}
       and state in ('created', 'retry', 'active')
  `);

  const liveJobReceiptIds = live.rows
    .map((row) => row.receipt_id)
    .filter((id): id is string => typeof id === "string");

  const lost = selectLostRecognitions({
    queued,
    liveJobReceiptIds,
    now: deps.now ?? new Date(),
  });

  for (const receiptId of lost) {
    await send(receiptId);
  }

  return { queued: queued.length, requeued: lost };
}
