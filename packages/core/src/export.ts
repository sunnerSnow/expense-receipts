/**
 * 月結匯出:清單欄位組裝與 CSV 序列化。
 *
 * 兩個刻意的決定:
 * 1. **不換算匯率**。外幣單據就列原幣 + 幣別,台幣換算由會計依實際入帳成本決定
 *    (見 ADR-0005)。系統猜匯率只會製造一個「看起來精確但其實是猜的」數字。
 * 2. **編號同時是影像檔名前綴**。會計看清單第 007 列,就去 zip 找 007 開頭那張,
 *    不必比對 UUID。
 */

import { amountToCents } from "./money";
import type { Deductibility, ReceiptDocType } from "./receipt";

/** 匯出所需的單據形狀(對應 DB receipts 的子集 + join 出來的名稱) */
export interface ReceiptForExport {
  id: string;
  invoiceDate: string | null;
  docType: ReceiptDocType;
  invoiceNumber: string | null;
  sellerName: string | null;
  sellerTaxId: string | null;
  buyerTaxId: string | null;
  currency: string;
  amount: string;
  taxAmount: string | null;
  deductibility: Deductibility | null;
  categoryName: string | null;
  uploaderName: string | null;
  note: string | null;
  imagePath: string | null;
}

/** 一列匯出資料(已排序、已編號) */
export interface ExportRow {
  /** 三位數流水號,如 "007";對應 zip 內的影像檔名前綴 */
  seq: string;
  invoiceDate: string;
  docTypeLabel: string;
  invoiceNumber: string;
  sellerName: string;
  sellerTaxId: string;
  buyerTaxId: string;
  currency: string;
  amount: string;
  taxAmount: string;
  deductibilityLabel: string;
  categoryName: string;
  uploaderName: string;
  note: string;
  /** zip 內的影像檔名;無影像為空字串 */
  imageFileName: string;
  /** 原始單據 id(給 worker 對應影像檔用,不進 CSV) */
  receiptId: string;
  /** 原始影像路徑(給 worker 讀檔用,不進 CSV) */
  imagePath: string | null;
}

export interface ExportBundle {
  rows: ExportRow[];
  /** 各幣別小計(不換算),幣別 → 金額字串 */
  currencyTotals: Record<string, string>;
  count: number;
}

const DOC_TYPE_LABELS: Record<ReceiptDocType, string> = {
  einvoice: "電子發票",
  triplicate: "三聯式發票",
  duplicate: "二聯式發票",
  cash_register: "收銀機發票",
  receipt: "收據",
  foreign: "國外單據",
  other: "其他",
};

const DEDUCTIBILITY_LABELS: Record<Deductibility, string> = {
  deductible: "可扣抵",
  expense_only: "僅費用憑證",
  review: "統編待確認",
};

/** CSV 欄位標題,順序即 CSV 欄位順序 */
export const EXPORT_COLUMNS = [
  "編號",
  "日期",
  "單據類型",
  "發票號碼",
  "賣方名稱",
  "賣方統編",
  "買方統編",
  "幣別",
  "金額",
  "稅額",
  "可否扣抵",
  "會計科目",
  "經手人",
  "摘要",
  "影像檔名",
] as const;

/** 檔名安全化:去掉作業系統與 zip 都可能出問題的字元 */
function safeFileNamePart(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|\r\n\t]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

/** 從影像路徑取副檔名(含點);取不到給 .jpg */
function extOf(imagePath: string): string {
  const match = /\.[A-Za-z0-9]{1,5}$/.exec(imagePath);
  return match ? match[0].toLowerCase() : ".jpg";
}

/**
 * 組裝匯出清單。
 *
 * 排序:日期 → 發票號碼 → id。刻意用穩定排序(而非 DB 的預設順序),
 * 這樣同一批單據重跑匯出,編號與影像檔名一致,方便對帳。
 */
export function buildExportRows(receipts: readonly ReceiptForExport[]): ExportBundle {
  const sorted = [...receipts].sort((a, b) => {
    const byDate = (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "");
    if (byDate !== 0) return byDate;
    const byNumber = (a.invoiceNumber ?? "").localeCompare(b.invoiceNumber ?? "");
    if (byNumber !== 0) return byNumber;
    return a.id.localeCompare(b.id);
  });

  const totalsCents = new Map<string, number>();
  const rows: ExportRow[] = sorted.map((r, index) => {
    const seq = String(index + 1).padStart(3, "0");
    const currency = (r.currency === "" ? "TWD" : r.currency).toUpperCase();
    totalsCents.set(currency, (totalsCents.get(currency) ?? 0) + amountToCents(r.amount));

    const namePart = safeFileNamePart(r.invoiceNumber ?? r.sellerName ?? r.invoiceDate ?? "單據");

    return {
      seq,
      invoiceDate: r.invoiceDate ?? "",
      docTypeLabel: DOC_TYPE_LABELS[r.docType],
      invoiceNumber: r.invoiceNumber ?? "",
      sellerName: r.sellerName ?? "",
      sellerTaxId: r.sellerTaxId ?? "",
      buyerTaxId: r.buyerTaxId ?? "",
      currency,
      amount: r.amount,
      taxAmount: r.taxAmount ?? "",
      deductibilityLabel: r.deductibility ? DEDUCTIBILITY_LABELS[r.deductibility] : "",
      categoryName: r.categoryName ?? "未分類",
      uploaderName: r.uploaderName ?? "",
      note: r.note ?? "",
      imageFileName: r.imagePath ? `${seq}_${namePart}${extOf(r.imagePath)}` : "",
      receiptId: r.id,
      imagePath: r.imagePath,
    };
  });

  const currencyTotals: Record<string, string> = {};
  // 台幣排前面,其餘照字母序,讓輸出穩定
  const currencies = [...totalsCents.keys()].sort((a, b) =>
    a === "TWD" ? -1 : b === "TWD" ? 1 : a.localeCompare(b),
  );
  for (const c of currencies) {
    currencyTotals[c] = ((totalsCents.get(c) ?? 0) / 100).toFixed(2);
  }

  return { rows, currencyTotals, count: rows.length };
}

/** 依 RFC 4180 逃逸單一欄位 */
function csvField(value: string): string {
  // 前導的 = + - @ 會被 Excel 當成公式,加單引號前綴阻止(統編、電話常踩到)
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * 序列化成 CSV 字串。
 *
 * - 開頭加 UTF-8 BOM:Excel 沒有 BOM 會把中文當 Big5 讀成亂碼
 * - 換行用 CRLF:Excel 對 LF 的容忍度較差
 */
export function toCsv(bundle: ExportBundle): string {
  const lines: string[] = [EXPORT_COLUMNS.map(csvField).join(",")];

  for (const r of bundle.rows) {
    lines.push(
      [
        r.seq,
        r.invoiceDate,
        r.docTypeLabel,
        r.invoiceNumber,
        r.sellerName,
        r.sellerTaxId,
        r.buyerTaxId,
        r.currency,
        r.amount,
        r.taxAmount,
        r.deductibilityLabel,
        r.categoryName,
        r.uploaderName,
        r.note,
        r.imageFileName,
      ]
        .map(csvField)
        .join(","),
    );
  }

  // 尾端小計:每個幣別一列,標在「金額」欄位下方。外幣不併入台幣。
  for (const [currency, total] of Object.entries(bundle.currencyTotals)) {
    const row = new Array<string>(EXPORT_COLUMNS.length).fill("");
    row[0] = "小計";
    row[7] = currency;
    row[8] = total;
    lines.push(row.map(csvField).join(","));
  }

  return `﻿${lines.join("\r\n")}\r\n`;
}

/** 匯出檔名,如 `報帳清單_2026-07.csv` */
export function exportFileName(year: number, month: number, ext: "csv" | "zip"): string {
  const base = `報帳清單_${year}-${String(month).padStart(2, "0")}`;
  return ext === "csv" ? `${base}.csv` : `報帳憑證_${year}-${String(month).padStart(2, "0")}.zip`;
}
