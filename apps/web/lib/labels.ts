import type { Deductibility, ReceiptDocType, ReceiptStatus, ReceiptSource } from "@expense-receipts/core";

export const DOC_TYPE_LABELS: Record<ReceiptDocType, string> = {
  einvoice: "電子發票",
  triplicate: "三聯式發票",
  duplicate: "二聯式發票",
  cash_register: "收銀機發票",
  receipt: "收據",
  foreign: "國外單據",
  other: "其他",
};

export const STATUS_LABELS: Record<ReceiptStatus, string> = {
  pending_review: "待確認",
  confirmed: "已確認",
  exported: "已匯出",
};

export const DEDUCTIBILITY_LABELS: Record<Deductibility, string> = {
  deductible: "可扣抵",
  expense_only: "費用憑證",
  review: "統編待確認",
};

export const SOURCE_LABELS: Record<ReceiptSource, string> = {
  qr: "掃碼",
  ai: "AI 辨識",
  manual: "手動輸入",
};

/** 手動輸入時可選的單據類型(排除 einvoice,那是掃碼專用) */
export const MANUAL_DOC_TYPES: ReceiptDocType[] = [
  "triplicate",
  "duplicate",
  "cash_register",
  "receipt",
  "foreign",
  "other",
];
