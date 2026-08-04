/**
 * 佇列的「契約」:名稱與 payload 形狀。
 *
 * 為什麼獨立成一個 package:web 端負責 send、worker 端負責 work,兩邊必須用
 * 同一組字串與同一個 payload 型別,但 apps 之間不能互相 import(依賴方向是
 * apps → packages)。這裡只有常數與型別,不含 pg-boss —— 各 app 自己建連線。
 */

export const QUEUES = {
  /** AI 辨識單據影像(Phase 2) */
  recognizeReceipt: "receipt.recognize",
  /** 產生月結匯出檔(Phase 3) */
  generateExport: "export.generate",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * 辨識工作的重試策略(由 send 端設定,pg-boss 的 SendOptions 形狀)。
 *
 * Gemini 免費額度有每分鐘請求上限,一次上傳多張就會撞到 429 —— 退避重試把
 * 這種暫時性失敗吸收掉,不必讓使用者自己按重試。
 */
export const RECOGNIZE_RETRY_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
} as const;

export interface RecognizeReceiptPayload {
  receiptId: string;
}

/**
 * 匯出工作的 payload 帶「期間 + 誰發起」,而不是既有的 export_batch id。
 *
 * 原因是鐵律 5:`export_batches` 只允許 INSERT。所以流程必須是
 * 「先產出檔案 → 再 INSERT 一筆帶檔案路徑的批次紀錄」,
 * 而不是「先建空批次 → 事後 UPDATE 補檔案路徑」。
 */
export interface GenerateExportPayload {
  periodYear: number;
  periodMonth: number;
  /** 發起匯出的使用者(寫進 export_batches.created_by) */
  createdBy: string;
}
