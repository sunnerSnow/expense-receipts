"use server";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { receipts } from "@expense-receipts/db";
import {
  assessDeductibility,
  canTransitionStatus,
  isValidAmount,
  RECEIPT_DOC_TYPES,
  type ReceiptDocType,
} from "@expense-receipts/core";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth";

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

/**
 * 建立單據。
 * - source='qr':電子發票掃碼,資料 100% 準確 → 直接 confirmed
 * - source='manual':人工輸入,由上傳者當場核對 → confirmed
 * (source='ai' 由 Phase 2 的 worker 產生,一律 pending_review)
 */
export async function createReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();

  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) return { error: "請選擇單據影像" };

  const source = str(formData, "source") === "qr" ? "qr" : "manual";
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
  const ext = extFromType(image.type);
  const filePath = path.join(env.UPLOAD_DIR, `${id}.${ext}`);
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  await writeFile(filePath, Buffer.from(await image.arrayBuffer()));

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
