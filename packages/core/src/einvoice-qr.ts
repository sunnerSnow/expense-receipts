/**
 * 台灣電子發票證明聯二維條碼解析。
 *
 * 證明聯上有左右兩個 QR code(財政部「電子發票證明聯二維條碼規格」):
 * - 左 QR:前 77 字元為固定長度表頭,之後以 `:` 分隔品項資訊
 * - 右 QR:以 `**` 開頭,接續左 QR 放不下的品項
 *
 * 表頭固定欄位(字元位置):
 *   0-9    發票號碼(2 碼英文字軌 + 8 碼數字)
 *   10-16  開立日期(民國年月日,yyyMMdd 共 7 碼)
 *   17-20  隨機碼(4 碼)
 *   21-28  銷售額/未稅(8 碼 16 進位)
 *   29-36  總計額/含稅(8 碼 16 進位)
 *   37-44  買方統編(8 碼,無統編時為 00000000)
 *   45-52  賣方統編(8 碼)
 *   53-76  加密驗證資訊(24 碼;驗證真偽需財政部金鑰,這裡保留原文不解析)
 *
 * 表頭之後:`:營業人自訂區(10):品目總筆數:本 QR 品目筆數:編碼參數:品名:數量:單價...`
 * 品名編碼參數 0=Big5、1=UTF-8、2=Base64。掃描器多半以 UTF-8 解出字串,
 * Big5 編碼的品名可能出現亂碼 —— 金額與統編等表頭欄位不受影響,壞掉的只會是品名。
 */

export interface EInvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface EInvoiceQr {
  /** 發票號碼,例 AB12345678 */
  invoiceNumber: string;
  /** 開立日期,ISO 格式(西元),例 2026-07-28 */
  invoiceDate: string;
  /** 4 碼隨機碼 */
  randomCode: string;
  /** 銷售額(未稅,新台幣整數) */
  salesAmount: number;
  /** 總計額(含稅,新台幣整數) */
  totalAmount: number;
  /** 買方統編;個人消費(00000000)為 null */
  buyerTaxId: string | null;
  /** 賣方統編 */
  sellerTaxId: string;
  /** QR 內記載的品項(可能少於發票實際品項,見 totalItemCount) */
  items: EInvoiceItem[];
  /** 發票品目總筆數;QR 容量不足時 items.length 會小於此數 */
  totalItemCount: number | null;
  /** 加密驗證資訊原文(24 碼) */
  encryptedVerification: string;
}

const HEADER_LENGTH = 77;
const INVOICE_NUMBER_RE = /^[A-Z]{2}\d{8}$/;
const HEX8_RE = /^[0-9A-Fa-f]{8}$/;
const TAX_ID_RE = /^\d{8}$/;

/** 快速判斷字串是否可能為左 QR(供掃描端路由兩顆 QR 用) */
export function isEInvoiceLeftQr(text: string): boolean {
  const t = text.trim();
  return t.length >= HEADER_LENGTH && INVOICE_NUMBER_RE.test(t.slice(0, 10));
}

/** 右 QR 以 `**` 開頭 */
export function isEInvoiceRightQr(text: string): boolean {
  return text.trim().startsWith("**");
}

/**
 * 解析電子發票證明聯 QR code。
 *
 * @param leftQr  左 QR 解碼後的字串(必要)
 * @param rightQr 右 QR 解碼後的字串(可選;提供時品項會接續合併)
 * @returns 結構化發票資料;格式不符時回傳 null(呼叫端 fallback 到 AI 辨識)
 */
export function parseEInvoiceQr(leftQr: string, rightQr?: string): EInvoiceQr | null {
  const text = leftQr.trim();
  if (text.length < HEADER_LENGTH) return null;

  const invoiceNumber = text.slice(0, 10);
  if (!INVOICE_NUMBER_RE.test(invoiceNumber)) return null;

  const rocDate = text.slice(10, 17);
  if (!/^\d{7}$/.test(rocDate)) return null;
  const year = Number(rocDate.slice(0, 3)) + 1911;
  const invoiceDate = `${year}-${rocDate.slice(3, 5)}-${rocDate.slice(5, 7)}`;

  const randomCode = text.slice(17, 21);

  const salesHex = text.slice(21, 29);
  const totalHex = text.slice(29, 37);
  if (!HEX8_RE.test(salesHex) || !HEX8_RE.test(totalHex)) return null;
  const salesAmount = Number.parseInt(salesHex, 16);
  const totalAmount = Number.parseInt(totalHex, 16);

  const buyerRaw = text.slice(37, 45);
  const sellerTaxId = text.slice(45, 53);
  if (!TAX_ID_RE.test(buyerRaw) || !TAX_ID_RE.test(sellerTaxId)) return null;
  const buyerTaxId = buyerRaw === "00000000" ? null : buyerRaw;

  const encryptedVerification = text.slice(53, HEADER_LENGTH);

  // 表頭之後的品項區:[":", 營業人自訂區, 品目總筆數, 本 QR 品目筆數, 編碼參數, 品名, 數量, 單價, ...]
  const tail = text.slice(HEADER_LENGTH);
  const fields = tail.split(":");
  let totalItemCount: number | null = null;
  const items: EInvoiceItem[] = [];
  if (fields.length >= 5) {
    const count = Number(fields[2]);
    totalItemCount = Number.isFinite(count) ? count : null;
    collectItems(fields.slice(5), items);
  }

  if (rightQr !== undefined && isEInvoiceRightQr(rightQr)) {
    collectItems(rightQr.trim().slice(2).split(":"), items);
  }

  return {
    invoiceNumber,
    invoiceDate,
    randomCode,
    salesAmount,
    totalAmount,
    buyerTaxId,
    sellerTaxId,
    items,
    totalItemCount,
    encryptedVerification,
  };
}

function collectItems(fields: string[], out: EInvoiceItem[]): void {
  for (let i = 0; i + 3 <= fields.length; i += 3) {
    const name = fields[i];
    const quantity = Number(fields[i + 1]);
    const unitPrice = Number(fields[i + 2]);
    if (name === undefined || name === "" || !Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
      continue;
    }
    out.push({ name, quantity, unitPrice });
  }
}
