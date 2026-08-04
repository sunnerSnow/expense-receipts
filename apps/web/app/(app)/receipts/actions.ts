"use server";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { receipts } from "@expense-receipts/db";
import {
  amountToCents,
  assessDeductibility,
  canTransitionStatus,
  isValidAmount,
  RECEIPT_DOC_TYPES,
  type ReceiptDocType,
} from "@expense-receipts/core";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { sendRecognizeJob } from "@/lib/queue";

export type ActionState = { error?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function extFromType(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** 空字串轉 null(給可選的 text 欄位用) */
function nullable(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v === "" ? null : v;
}

function isDocType(v: string): v is ReceiptDocType {
  return (RECEIPT_DOC_TYPES as readonly string[]).includes(v);
}

/** 影像落地;回傳寫入的路徑 */
async function saveImage(image: File, id: string): Promise<string> {
  const filePath = path.join(env.UPLOAD_DIR, `${id}.${extFromType(image.type)}`);
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  await writeFile(filePath, Buffer.from(await image.arrayBuffer()));
  return filePath;
}

/**
 * 建立單據。
 * - source='qr':電子發票掃碼,資料 100% 準確 → 直接 confirmed
 * - source='manual':人工輸入,由上傳者當場核對 → confirmed
 * - source='ai':只存影像與派工,欄位由 worker 辨識後回填 → 一律 pending_review(鐵律 3)
 */
export async function createReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();

  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) return { error: "請選擇單據影像" };

  const sourceRaw = str(formData, "source");
  if (sourceRaw === "ai") return createAiReceipt(user.id, image, formData);

  const source = sourceRaw === "qr" ? "qr" : "manual";
  const docType = source === "qr" ? "einvoice" : str(formData, "docType");
  if (!isDocType(docType)) return { error: "單據類型不正確" };

  const invoiceDate = str(formData, "invoiceDate");
  if (!DATE_RE.test(invoiceDate)) return { error: "請填寫日期(YYYY-MM-DD)" };

  const amount = str(formData, "amount");
  if (!isValidAmount(amount)) return { error: "金額格式不正確" };

  const taxAmountRaw = str(formData, "taxAmount");
  if (taxAmountRaw !== "" && !isValidAmount(taxAmountRaw)) return { error: "稅額格式不正確" };

  const buyerTaxId = nullable(formData, "buyerTaxId");
  const sellerTaxId = nullable(formData, "sellerTaxId");

  const deductibility = assessDeductibility({
    docType,
    buyerTaxId,
    companyTaxId: env.COMPANY_TAX_ID,
  });

  const id = randomUUID();
  const filePath = await saveImage(image, id);

  const rawDataRaw = str(formData, "rawData");
  let rawData: unknown = null;
  if (rawDataRaw !== "") {
    try {
      rawData = JSON.parse(rawDataRaw);
    } catch {
      rawData = null;
    }
  }

  await getDb().insert(receipts).values({
    id,
    uploaderId: user.id,
    context: "company",
    docType,
    source,
    status: "confirmed",
    invoiceNumber: nullable(formData, "invoiceNumber"),
    invoiceDate,
    sellerName: nullable(formData, "sellerName"),
    sellerTaxId,
    buyerTaxId,
    currency: str(formData, "currency") || "TWD",
    amount,
    taxAmount: taxAmountRaw === "" ? null : taxAmountRaw,
    deductibility,
    categoryId: nullable(formData, "categoryId"),
    note: nullable(formData, "note"),
    imagePath: filePath,
    rawData,
  });

  redirect(`/receipts/${id}`);
}

/**
 * AI 辨識路徑:先落地影像 + 建一筆空殼單據,再派工給 worker。
 *
 * 為什麼先建空殼:job payload 只帶 receiptId,worker 靠它找影像與寫回結果;
 * 而且使用者上傳完就能在列表看到「辨識中」,不用停在上傳頁等。
 * 金額先放 0 —— 它是 NOT NULL,而 recognition_status='queued' 才是「還沒有資料」
 * 的真正判準,確認入帳會被擋住(見 confirmReceipt)。
 */
async function createAiReceipt(
  uploaderId: string,
  image: File,
  formData: FormData,
): Promise<ActionState> {
  const id = randomUUID();
  const filePath = await saveImage(image, id);

  await getDb().insert(receipts).values({
    id,
    uploaderId,
    context: "company",
    docType: "other", // 佔位,辨識後由 worker 更正
    source: "ai",
    status: "pending_review",
    currency: "TWD",
    amount: "0",
    categoryId: nullable(formData, "categoryId"),
    note: nullable(formData, "note"),
    imagePath: filePath,
    recognitionStatus: "queued",
  });

  try {
    await sendRecognizeJob({ receiptId: id });
  } catch (err) {
    // 派工失敗要寫回 DB,否則單據會永遠停在「辨識中」查不出原因
    await getDb()
      .update(receipts)
      .set({
        recognitionStatus: "failed",
        recognitionError: `辨識工作派送失敗:${(err as Error)?.message ?? "未知錯誤"}`,
      })
      .where(eq(receipts.id, id));
  }

  redirect(`/receipts/${id}`);
}

/** 重新派送辨識(辨識失敗或結果不理想時用) */
export async function retryRecognition(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const id = str(formData, "id");
  const rec = await loadReceipt(id);
  if (!rec) return { error: "找不到單據" };
  if (rec.source !== "ai") return { error: "只有 AI 辨識的單據可以重新辨識" };
  if (rec.status !== "pending_review") return { error: "已確認的單據不再重新辨識" };
  if (rec.recognitionStatus === "queued") return { error: "辨識中,請稍候" };

  await getDb()
    .update(receipts)
    .set({ recognitionStatus: "queued", recognitionError: null, updatedAt: new Date() })
    .where(eq(receipts.id, id));

  try {
    await sendRecognizeJob({ receiptId: id });
  } catch (err) {
    const message = `辨識工作派送失敗:${(err as Error)?.message ?? "未知錯誤"}`;
    await getDb()
      .update(receipts)
      .set({ recognitionStatus: "failed", recognitionError: message })
      .where(eq(receipts.id, id));
    return { error: message };
  }

  revalidatePath(`/receipts/${id}`);
  redirect(`/receipts/${id}`);
}

async function loadReceipt(id: string) {
  const rows = await getDb().select().from(receipts).where(eq(receipts.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 編輯單據欄位;已匯出的不可修改(鐵律 5) */
export async function updateReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const id = str(formData, "id");
  const rec = await loadReceipt(id);
  if (!rec) return { error: "找不到單據" };
  if (rec.status === "exported") return { error: "已匯出的單據不可修改" };
  // 辨識中就編輯,worker 回填時會蓋掉你剛打的字
  if (rec.recognitionStatus === "queued") return { error: "AI 辨識中,請稍候再編輯" };

  const docType = str(formData, "docType");
  if (!isDocType(docType)) return { error: "單據類型不正確" };

  const invoiceDate = str(formData, "invoiceDate");
  if (!DATE_RE.test(invoiceDate)) return { error: "請填寫日期(YYYY-MM-DD)" };

  const amount = str(formData, "amount");
  if (!isValidAmount(amount)) return { error: "金額格式不正確" };

  const taxAmountRaw = str(formData, "taxAmount");
  if (taxAmountRaw !== "" && !isValidAmount(taxAmountRaw)) return { error: "稅額格式不正確" };

  const buyerTaxId = nullable(formData, "buyerTaxId");
  const deductibility = assessDeductibility({ docType, buyerTaxId, companyTaxId: env.COMPANY_TAX_ID });

  await getDb()
    .update(receipts)
    .set({
      docType,
      invoiceNumber: nullable(formData, "invoiceNumber"),
      invoiceDate,
      sellerName: nullable(formData, "sellerName"),
      sellerTaxId: nullable(formData, "sellerTaxId"),
      buyerTaxId,
      amount,
      taxAmount: taxAmountRaw === "" ? null : taxAmountRaw,
      deductibility,
      categoryId: nullable(formData, "categoryId"),
      note: nullable(formData, "note"),
      // 人工已接手核對,AI 的待核對提示與失敗訊息不再需要顯示
      recognitionWarnings: null,
      recognitionError: null,
      updatedAt: new Date(),
    })
    .where(eq(receipts.id, id));

  revalidatePath(`/receipts/${id}`);
  redirect(`/receipts/${id}`);
}

/** 待確認 → 已確認(狀態轉換規則走 core 的 canTransitionStatus) */
export async function confirmReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const id = str(formData, "id");
  const rec = await loadReceipt(id);
  if (!rec) return { error: "找不到單據" };
  if (!canTransitionStatus(rec.status, "confirmed")) return { error: "此狀態無法確認" };
  // 辨識還沒回來,欄位是空殼(金額 0),不能就這樣入帳
  if (rec.recognitionStatus === "queued") return { error: "AI 辨識中,請等辨識完成再確認" };
  // 沒有日期的單據會落在所有月份篩選之外(月結匯出也撈不到),不可入帳
  if (rec.invoiceDate === null) return { error: "日期未填,請先補上日期再確認" };
  if (amountToCents(rec.amount) === 0) return { error: "金額為 0,請先填入正確金額再確認" };

  await getDb()
    .update(receipts)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(eq(receipts.id, id));

  revalidatePath(`/receipts/${id}`);
  redirect(`/receipts/${id}`);
}

/** 刪除單據;已匯出的不可刪。影像檔保留(鐵律 6:憑證只增不刪) */
export async function deleteReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const id = str(formData, "id");
  const rec = await loadReceipt(id);
  if (!rec) return { error: "找不到單據" };
  if (rec.status === "exported") return { error: "已匯出的單據不可刪除" };

  await getDb().delete(receipts).where(eq(receipts.id, id));
  redirect("/receipts");
}
