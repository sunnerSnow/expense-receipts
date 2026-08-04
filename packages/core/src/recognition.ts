/**
 * AI 辨識的「契約層」:提示詞、輸出 JSON Schema、回傳結果的正規化與驗證。
 *
 * 為什麼放在 core:辨識供應商可以換(見 ADR-0004),但「要模型吐什麼欄位、
 * 吐回來怎麼驗」是業務規則,不該散落在 worker 的 IO 程式裡。worker 只負責
 * 讀影像、呼叫 API、寫回 DB。
 *
 * 設計取捨:schema 裡所有欄位都是 **string 且 required**,金額也用字串。
 * - 全 required:模型不會偷偷省略欄位,「讀不到」統一以空字串表達,分支只有一種
 * - 金額用字串:避免 JSON number 的浮點誤差(DB 是 numeric(12,2)),
 *   與 money.ts 的「一律轉分再算」同一個理由
 */

import { assessDeductibility, RECEIPT_DOC_TYPES, type Deductibility, type ReceiptDocType } from "./receipt";

/** 模型回傳的原始欄位(未經驗證,全部可能是空字串或亂填) */
export interface RawRecognition {
  docType: string;
  invoiceNumber: string;
  invoiceDate: string;
  sellerName: string;
  sellerTaxId: string;
  buyerTaxId: string;
  currency: string;
  amount: string;
  taxAmount: string;
  categoryCode: string;
  summary: string;
}

/** 正規化後、可直接寫進 receipts 的形狀 */
export interface NormalizedRecognition {
  docType: ReceiptDocType;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  sellerName: string | null;
  sellerTaxId: string | null;
  buyerTaxId: string | null;
  currency: string;
  /** 含稅總額,固定兩位小數的字串 */
  amount: string;
  taxAmount: string | null;
  categoryCode: string | null;
  deductibility: Deductibility;
  summary: string | null;
  /**
   * 要提醒人工注意的地方(不阻擋入庫,但會顯示在待確認畫面)。
   * 這是「AI 必經人工確認」這道關卡的實質內容:告訴人該看哪裡。
   */
  warnings: string[];
}

export type RecognitionResult =
  | { ok: true; value: NormalizedRecognition }
  | { ok: false; error: string };

/** 統一發票類型(有發票號碼、可能可扣抵) */
const UNIFORM_INVOICE_TYPES: readonly ReceiptDocType[] = [
  "einvoice",
  "triplicate",
  "duplicate",
  "cash_register",
];

const DOC_TYPE_HINTS: Record<ReceiptDocType, string> = {
  einvoice: "電子發票證明聯(有左右兩個 QR code)",
  triplicate: "手開三聯式統一發票(有扣抵欄、載明買方統編)",
  duplicate: "手開二聯式統一發票(無扣抵欄)",
  cash_register: "收銀機統一發票(舊式紙捲,無 QR code)",
  receipt: "普通收據、免用統一發票收據、支出證明單",
  foreign: "國外單據(外幣、非中文格式)",
  other: "以上皆不符",
};

/**
 * 產生給模型的提示詞。
 *
 * @param categories 目前啟用的分類(code + name),模型只能從中選
 * @param companyTaxId 本公司統編 —— 告訴模型「買方統編」要特別看清楚,
 *        因為它直接決定進項稅額可否扣抵
 */
export function buildRecognitionPrompt(input: {
  categories: readonly { code: string; name: string }[];
  /** 本公司統編;null 表示未設定(只報海外單據或不主張進項扣抵) */
  companyTaxId: string | null;
}): string {
  const docTypes = RECEIPT_DOC_TYPES.map((t) => `- ${t}:${DOC_TYPE_HINTS[t]}`).join("\n");
  const cats =
    input.categories.length === 0
      ? "(無可用分類,categoryCode 一律回空字串)"
      : input.categories.map((c) => `- ${c.code}:${c.name}`).join("\n");

  return `你是台灣公司報帳的單據辨識助理。請看這張單據影像,擷取報帳所需欄位。

## 單據類型(docType,選一個)
${docTypes}

## 分類(categoryCode,依消費內容選一個最貼切的)
${cats}

## 規則(務必遵守)
1. **只讀影像上真的看得到的字**。看不清、被遮住、單據上沒有的欄位,一律回空字串 ""。
   絕對不要推測、不要用常識補、不要拿店名去猜統編。
2. **日期一律轉成西元 YYYY-MM-DD**。台灣單據常用民國年(如「115-03-08」或「1150308」
   表示民國 115 年 = 西元 2026 年,加 1911)。看不出年份就回空字串。
3. **金額 amount 是「含稅總金額」**(顧客實付的那個數字),純數字不含貨幣符號與千分位,
   例如 1050 或 1050.00。有「總計」「應收」「合計」欄位時以它為準。
4. **taxAmount 是營業稅額**。單據上有印才填,沒印就回空字串 —— 不要自己用 5% 算。
5. **統一編號是 8 碼數字**。${
     input.companyTaxId === null
       ? "買方統編通常印在「買受人」「統一編號」欄位;賣方統編是開票店家的。"
       : `買方統編(本公司統編為 ${input.companyTaxId})通常印在「買受人」「統一編號」欄位;賣方統編是開票店家的。`
   }分不清是誰的就都回空字串。
6. **台灣發票號碼格式是 2 個英文字母 + 8 碼數字**(如 AB12345678)。收據沒有發票號碼,回空字串。
7. currency 用 ISO 4217 代碼,台灣單據是 TWD。
8. summary 用 10~30 字中文描述消費內容(例如「便利商店文具與飲料」),供報帳說明用。

## 國外單據(海外出差)
遇到非台灣的單據(外文、外幣、如泰國 THB、日本 JPY):
- docType 一律回 **foreign**,不要硬套台灣的發票類型
- currency 回**實際幣別**(如 THB),amount 回**單據上的原幣金額**,不要換算台幣
- 稅額看單據自己印的(泰國 VAT 7%、日本消費稅 10%…),照抄不要自己算
- 統一編號照抄(國外常超過 8 碼,如泰國 13 碼「0105526048623」)
- invoiceNumber 放單據上的發票/收據編號(如「INV# 501083100023776」就回 501083100023776)

寧可留空讓人補,也不要猜錯 —— 這些數字會直接進公司帳務與稅務申報。`;
}

/**
 * 產生 structured output 用的 JSON Schema。
 *
 * @param categoryCodes 允許的分類代碼;空字串一併列入 enum,代表「無法判斷」
 */
export function buildRecognitionJsonSchema(categoryCodes: readonly string[]): object {
  return {
    type: "object",
    properties: {
      docType: { type: "string", enum: [...RECEIPT_DOC_TYPES], description: "單據類型" },
      invoiceNumber: { type: "string", description: "統一發票號碼,如 AB12345678;無則空字串" },
      invoiceDate: { type: "string", description: "西元 YYYY-MM-DD;判讀不出則空字串" },
      sellerName: { type: "string", description: "賣方(店家)名稱;無則空字串" },
      sellerTaxId: { type: "string", description: "賣方統一編號 8 碼數字;無則空字串" },
      buyerTaxId: { type: "string", description: "買方統一編號 8 碼數字;無則空字串" },
      currency: { type: "string", description: "ISO 4217 幣別代碼,台灣單據為 TWD" },
      amount: { type: "string", description: "含稅總金額,純數字字串,如 1050.00" },
      taxAmount: { type: "string", description: "營業稅額,純數字字串;單據未印則空字串" },
      categoryCode: {
        type: "string",
        enum: [...categoryCodes, ""],
        description: "分類代碼;無法判斷則空字串",
      },
      summary: { type: "string", description: "消費內容摘要,10~30 字中文" },
    },
    required: [
      "docType",
      "invoiceNumber",
      "invoiceDate",
      "sellerName",
      "sellerTaxId",
      "buyerTaxId",
      "currency",
      "amount",
      "taxAmount",
      "categoryCode",
      "summary",
    ],
    propertyOrdering: [
      "docType",
      "invoiceDate",
      "sellerName",
      "sellerTaxId",
      "buyerTaxId",
      "invoiceNumber",
      "currency",
      "amount",
      "taxAmount",
      "categoryCode",
      "summary",
    ],
  };
}

/** 取字串欄位,非字串或空白一律視為「沒有」 */
function field(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v.trim() : "";
}

/** 民國年轉西元;已是西元則原樣回傳。回 null 表示無法判讀 */
function normalizeDate(raw: string): string | null {
  const s = raw.replace(/[/.]/g, "-").trim();

  // YYYYMMDD / YYYMMDD(民國三碼)
  const compact = /^(\d{3,4})(\d{2})(\d{2})$/.exec(s.replace(/-/g, ""));
  if (compact) {
    const [, y, m, d] = compact as unknown as [string, string, string, string];
    return buildDate(y, m, d);
  }

  const parts = /^(\d{2,4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!parts) return null;
  const [, y, m, d] = parts as unknown as [string, string, string, string];
  return buildDate(y, m, d);
}

function buildDate(yRaw: string, mRaw: string, dRaw: string): string | null {
  let year = Number(yRaw);
  const month = Number(mRaw);
  const day = Number(dRaw);
  // 3 碼以下視為民國年(115 → 2026);2 碼也是民國(如 99 年)
  if (year < 1911) year += 1911;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // 擋掉 2026-02-31 這種日期
  const probe = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.getUTCDate() !== day) return null;
  return iso;
}

/** 金額字串 → 兩位小數字串;非法回 null */
function normalizeAmount(raw: string): string | null {
  const s = raw.replace(/[,\s$NT元]/gi, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/** 台灣統編:只留數字,必須剛好 8 碼 */
function normalizeTaxId(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

/** 國外統一編號:各國長度不同(如泰國 13 碼),只做寬鬆的合理性檢查 */
function normalizeForeignTaxId(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 20 ? digits : null;
}

/** 台灣發票號碼:去空白與連字號、轉大寫,須為 2 英文字母 + 8 數字 */
function normalizeInvoiceNumber(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z]{2}\d{8}$/.test(s) ? s : null;
}

/**
 * 國外單據號碼:自由格式(如泰國 `501083100023776`、`260705-02-10267`)。
 * 只去頭尾空白並限長度 —— 它仍然吃發票號碼的唯一索引,能擋重複上傳。
 */
function normalizeForeignDocNumber(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ").toUpperCase();
  return s.length >= 3 && s.length <= 40 ? s : null;
}

function isDocType(v: string): v is ReceiptDocType {
  return (RECEIPT_DOC_TYPES as readonly string[]).includes(v);
}

/**
 * 驗證與正規化模型回傳的辨識結果。
 *
 * 失敗(ok: false)只有兩種情況:回傳不是物件、或金額讀不出來 —— 金額是報帳的
 * 最小必要資訊,沒有它這筆單據無法成立,該讓人工接手而不是塞個 0 進帳。
 * 其他欄位讀不到都只是留空 + warning,不阻擋。
 */
export function normalizeRecognition(
  raw: unknown,
  options: { categoryCodes: readonly string[]; companyTaxId: string | null },
): RecognitionResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "辨識結果不是物件" };
  }
  const obj = raw as Record<string, unknown>;
  const warnings: string[] = [];

  const amount = normalizeAmount(field(obj, "amount"));
  if (amount === null) return { ok: false, error: "AI 未能讀出金額,請手動輸入" };

  const docTypeRaw = field(obj, "docType");
  let docType: ReceiptDocType;
  if (isDocType(docTypeRaw)) {
    docType = docTypeRaw;
  } else {
    docType = "other";
    warnings.push(`單據類型無法判斷(模型回「${docTypeRaw || "空白"}」),已歸為「其他」`);
  }
  if (docType === "einvoice") {
    // 走到 AI 這條路,代表 QR 沒解出來 —— 有可能是條碼糊掉,也有可能是模型看錯
    warnings.push("模型判定為電子發票,但條碼未能解讀,請核對發票號碼與金額");
  }

  let currency = field(obj, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    if (currency !== "") warnings.push(`幣別「${currency}」無法辨識,已視為 TWD`);
    currency = "TWD";
  }

  /**
   * 是否套用台灣專屬的欄位規則(8 碼統編、2 字母+8 數字發票號碼、5% 營業稅)。
   *
   * 國外單據不能套:泰國統編 13 碼、VAT 7%、收據號碼是自由格式。硬套只會讓
   * 每張海外單據都跳一串假警告 —— 警告一多就會被無視,反而害到真正該看的那些。
   */
  const isTaiwanDoc = currency === "TWD" && docType !== "foreign";

  const invoiceDateRaw = field(obj, "invoiceDate");
  const invoiceDate = invoiceDateRaw === "" ? null : normalizeDate(invoiceDateRaw);
  if (invoiceDate === null) warnings.push("日期未讀出,請補填");

  const invoiceNumberRaw = field(obj, "invoiceNumber");
  const invoiceNumber =
    invoiceNumberRaw === ""
      ? null
      : isTaiwanDoc
        ? normalizeInvoiceNumber(invoiceNumberRaw)
        : normalizeForeignDocNumber(invoiceNumberRaw);
  if (invoiceNumberRaw !== "" && invoiceNumber === null) {
    warnings.push(`單據號碼格式不正確(「${invoiceNumberRaw}」),已略去`);
  } else if (invoiceNumber === null && UNIFORM_INVOICE_TYPES.includes(docType)) {
    warnings.push("統一發票但未讀出發票號碼,請補填(去重與扣抵都靠它)");
  }

  const taxIdLabel = isTaiwanDoc ? "統編不是 8 碼數字" : "統一編號格式不正確";
  const parseTaxId = (raw: string) => (isTaiwanDoc ? normalizeTaxId(raw) : normalizeForeignTaxId(raw));

  const sellerTaxIdRaw = field(obj, "sellerTaxId");
  const sellerTaxId = sellerTaxIdRaw === "" ? null : parseTaxId(sellerTaxIdRaw);
  if (sellerTaxIdRaw !== "" && sellerTaxId === null) {
    warnings.push(`賣方${taxIdLabel}(「${sellerTaxIdRaw}」),已略去`);
  }

  const buyerTaxIdRaw = field(obj, "buyerTaxId");
  const buyerTaxId = buyerTaxIdRaw === "" ? null : parseTaxId(buyerTaxIdRaw);
  if (buyerTaxIdRaw !== "" && buyerTaxId === null) {
    warnings.push(`買方${taxIdLabel}(「${buyerTaxIdRaw}」),已略去`);
  }
  // 只有台灣單據、且有設定公司統編時才談「打錯本公司統編」
  if (
    isTaiwanDoc &&
    options.companyTaxId !== null &&
    buyerTaxId !== null &&
    buyerTaxId !== options.companyTaxId
  ) {
    warnings.push(`買方統編 ${buyerTaxId} 不是本公司統編,請確認是否打錯統編`);
  }

  const taxAmountRaw = field(obj, "taxAmount");
  const taxAmount = taxAmountRaw === "" ? null : normalizeAmount(taxAmountRaw);
  if (taxAmountRaw !== "" && taxAmount === null) {
    warnings.push(`稅額格式不正確(「${taxAmountRaw}」),已略去`);
  }
  if (taxAmount !== null) {
    const net = Number(amount) - Number(taxAmount);
    if (net <= 0) {
      warnings.push(`稅額 ${taxAmount} 不小於總額 ${amount},其中一個應該讀錯了,請核對`);
    } else if (isTaiwanDoc && UNIFORM_INVOICE_TYPES.includes(docType)) {
      // 台灣營業稅 5%:未稅額 = 含稅總額 − 稅額,稅額應約等於未稅額 × 5%。
      //
      // 不要反推「含稅 ≈ 稅額 × 21」—— 發票上的稅額是進位到整數的,那個誤差
      // 乘 21 倍後可達 ±10 元,會讓正常發票(如 1050 + 53 = 1103)被誤判。
      // 稅率是各國各自的事(泰國 7%),所以這個檢查只對台幣台灣單據做。
      if (Math.abs(net * 0.05 - Number(taxAmount)) > 1) {
        warnings.push(`金額 ${amount} 與稅額 ${taxAmount} 不符 5% 營業稅比例,請核對`);
      }
    }
  }

  if (currency !== "TWD") {
    // 金額存原幣(見 domain-model);月統計與匯出不會自動換算成台幣
    warnings.push(`外幣單據:金額 ${amount} ${currency} 為原幣,報帳時需自行換算台幣`);
  }

  const categoryCodeRaw = field(obj, "categoryCode");
  const categoryCode =
    categoryCodeRaw !== "" && options.categoryCodes.includes(categoryCodeRaw) ? categoryCodeRaw : null;
  if (categoryCode === null) warnings.push("分類未能判斷,請手動選擇");

  const sellerNameRaw = field(obj, "sellerName");
  const summaryRaw = field(obj, "summary");

  return {
    ok: true,
    value: {
      docType,
      invoiceNumber,
      invoiceDate,
      sellerName: sellerNameRaw === "" ? null : sellerNameRaw,
      sellerTaxId,
      buyerTaxId,
      currency,
      amount,
      taxAmount,
      categoryCode,
      deductibility: assessDeductibility({ docType, buyerTaxId, companyTaxId: options.companyTaxId }),
      summary: summaryRaw === "" ? null : summaryRaw,
      warnings,
    },
  };
}
