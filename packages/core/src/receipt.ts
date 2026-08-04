/**
 * 單據的共用型別與進項稅額可扣抵判斷。
 *
 * 注意:這些 enum 值與 packages/db 的 schema 欄位 enum 手動保持同步
 * (db 不 import core,維持兩者互不依賴 —— 見 docs/conventions.md)。
 */

/** 單據類型 */
export const RECEIPT_DOC_TYPES = [
  "einvoice", // 電子發票證明聯
  "triplicate", // 手開三聯式統一發票
  "duplicate", // 手開二聯式統一發票
  "cash_register", // 收銀機統一發票(舊式,無 QR)
  "receipt", // 普通收據(小規模營業人)
  "foreign", // 國外單據
  "other",
] as const;
export type ReceiptDocType = (typeof RECEIPT_DOC_TYPES)[number];

/** 資料來源 */
export const RECEIPT_SOURCES = ["qr", "ai", "manual"] as const;
export type ReceiptSource = (typeof RECEIPT_SOURCES)[number];

/** 單據狀態:pending_review → confirmed → exported(單向,不可回頭) */
export const RECEIPT_STATUSES = ["pending_review", "confirmed", "exported"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/**
 * AI 辨識工作的生命週期(只對 source='ai' 的單據有意義)。
 * - none:不走 AI(QR 或手動輸入)
 * - queued:已派工,worker 還沒處理完 —— 此時單據欄位是空殼,不可確認入帳
 * - succeeded:辨識完成,欄位已填,等人工確認
 * - failed:辨識失敗(讀不出金額、API 錯誤、發票號碼撞去重),需人工接手
 */
export const RECOGNITION_STATUSES = ["none", "queued", "succeeded", "failed"] as const;
export type RecognitionStatus = (typeof RECOGNITION_STATUSES)[number];

/** 進項稅額可扣抵判定結果 */
export type Deductibility = "deductible" | "expense_only" | "review";

/** 可以主張進項稅額扣抵的憑證類型(必須是統一發票且買方統編為本公司) */
const TAX_CREDIT_DOC_TYPES: readonly ReceiptDocType[] = [
  "einvoice",
  "triplicate",
  "cash_register",
];

/**
 * 判斷單據的進項稅額可否扣抵。
 *
 * - 統一發票 + 買方統編 = 公司統編 → deductible(可扣抵)
 * - 統一發票 + 買方統編是別人的 → review(可能打錯統編,要人工確認)
 * - 其餘(收據、二聯式、國外單據、未打統編)→ expense_only(僅作費用憑證)
 *
 * `companyTaxId` 為 null 代表**沒有設定公司統編**(例如只報海外單據、或不主張
 * 進項扣抵)。此時遇到「有買方統編的統一發票」不猜可否扣抵,一律回 review 交人工
 * —— 沒有比對基準就宣告 deductible 會是憑空斷言。
 */
export function assessDeductibility(input: {
  docType: ReceiptDocType;
  buyerTaxId: string | null;
  companyTaxId: string | null;
}): Deductibility {
  if (!TAX_CREDIT_DOC_TYPES.includes(input.docType)) return "expense_only";
  if (input.buyerTaxId === null) return "expense_only";
  if (input.companyTaxId === null) return "review";
  if (input.buyerTaxId !== input.companyTaxId) return "review";
  return "deductible";
}

/** 合法的狀態轉換(除此之外一律拒絕;exported 為終態) */
const STATUS_TRANSITIONS: Readonly<Record<ReceiptStatus, readonly ReceiptStatus[]>> = {
  pending_review: ["confirmed"],
  confirmed: ["exported"],
  exported: [],
};

export function canTransitionStatus(from: ReceiptStatus, to: ReceiptStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}
