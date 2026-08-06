/**
 * 「辨識中」孤兒單據的救援判斷。
 *
 * 為什麼需要:pg-boss 的工作預設只保留 14 天(job 表的
 * `keep_until default now() + interval '14 days'`)。這套系統是「要用才開電腦」
 * 的模式 —— 上傳完馬上關機、一個月後才開機,那個工作已經被清掉了,但單據的
 * `recognition_status` 還停在 `queued`。畫面上會永遠顯示「辨識中」:沒有錯誤
 * 訊息、不會重試、使用者也點不了「重新辨識」,只能進資料庫手動處理。
 *
 * 辨識跑到一半斷電、或重試次數用盡後工作被清掉,結局也一樣。
 *
 * 這裡只做判斷(純函式);查資料庫與重新派工留在 worker。
 */

/** 目前掛在 `recognition_status = 'queued'` 的單據 */
export interface QueuedRecognition {
  receiptId: string;
  /** 單據最後一次被寫入的時間(派工時會一起更新) */
  updatedAt: Date;
}

export interface LostRecognitionInput {
  queued: readonly QueuedRecognition[];
  /** 佇列裡還活著(created / retry / active)的工作所對應的單據 id */
  liveJobReceiptIds: readonly string[];
  now: Date;
  /** 超過這段時間仍找不到對應工作才算孤兒 */
  staleAfterMs?: number;
}

/**
 * 預設的判定門檻:15 分鐘。
 *
 * 取這個值是對齊 pg-boss 的 `expire_in`(預設 15 分鐘)—— 一個工作最長就是
 * 卡在 active 這麼久才會被判逾時。門檻同時也擋掉一個競態:web 剛送出工作、
 * 而 worker 正好在這一瞬間啟動掃描,兩邊讀到的快照可能不一致。
 */
export const RECOGNITION_STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * 挑出「掛在辨識中,但佇列裡已經沒有對應工作」的單據 id,依輸入順序回傳。
 *
 * 刻意保守:只要佇列裡還有活著的工作就不碰,寧可晚一輪救援,也不要重複派工
 * 讓同一張單據被辨識兩次(每一次都是一筆 API 呼叫)。
 */
export function selectLostRecognitions({
  queued,
  liveJobReceiptIds,
  now,
  staleAfterMs = RECOGNITION_STALE_AFTER_MS,
}: LostRecognitionInput): string[] {
  const threshold =
    Number.isFinite(staleAfterMs) && staleAfterMs >= 0 ? staleAfterMs : RECOGNITION_STALE_AFTER_MS;
  const cutoff = now.getTime() - threshold;
  const live = new Set(liveJobReceiptIds);

  const lost: string[] = [];
  const seen = new Set<string>();

  for (const item of queued) {
    if (item.receiptId === "" || seen.has(item.receiptId)) continue;
    if (live.has(item.receiptId)) continue;
    // updatedAt 壞掉時 getTime() 是 NaN,比較會是 false —— 於是判定為孤兒。
    // 這個方向是對的:重派一次工作的代價,遠小於單據永遠卡在「辨識中」。
    if (item.updatedAt.getTime() > cutoff) continue;

    seen.add(item.receiptId);
    lost.push(item.receiptId);
  }

  return lost;
}
