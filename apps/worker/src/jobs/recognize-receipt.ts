import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { categories, receipts, type Db } from "@expense-receipts/db";
import {
  buildRecognitionJsonSchema,
  buildRecognitionPrompt,
  normalizeRecognition,
} from "@expense-receipts/core";
import type { RecognizeReceiptPayload } from "@expense-receipts/queue";
import { env } from "../env";
import { TransientRecognitionError, type ReceiptRecognizer } from "../recognizer";

/** 副檔名 → MIME(Gemini 接受 png/jpeg/webp/heic/heif) */
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

/** PostgreSQL unique_violation */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * 沿著 cause 鏈找 PostgreSQL 錯誤代碼。
 *
 * 必要性:Drizzle 會把 pg 的原始錯誤包一層(`DrizzleQueryError.cause`),
 * 只看 `err.code` 抓不到 —— 結果去重衝突會變成未處理的例外、被 pg-boss
 * 當成暫時性錯誤反覆重試,單據永遠停在「辨識中」。
 */
function pgErrorCode(err: unknown): string | undefined {
  let cursor: unknown = err;
  for (let depth = 0; depth < 5 && cursor !== null && typeof cursor === "object"; depth += 1) {
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === PG_UNIQUE_VIOLATION;
}

/** 辨識工作的處理結果,供呼叫端決定要不要交回 pg-boss 重試 */
export type JobOutcome =
  | { kind: "done" }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string }
  /** 暫時性錯誤:單據仍留在 queued,呼叫端可丟出去讓 pg-boss 重試 */
  | { kind: "transient"; error: string };

/** 把單據標記為辨識失敗;錯誤訊息會顯示在明細頁,寫給人看不是給機器看 */
export async function markRecognitionFailed(
  db: Db,
  receiptId: string,
  error: string,
): Promise<void> {
  await db
    .update(receipts)
    .set({ recognitionStatus: "failed", recognitionError: error, updatedAt: new Date() })
    .where(eq(receipts.id, receiptId));
}

async function markFailed(db: Db, receiptId: string, error: string): Promise<JobOutcome> {
  await markRecognitionFailed(db, receiptId, error);
  return { kind: "failed", error };
}

/**
 * AI 辨識一張單據。
 *
 * 鐵律 3:辨識完成後 status 一律維持 pending_review,不得直接 confirmed ——
 * 這個函式從不寫 status 欄位,只填欄位內容與 recognition_* 狀態。
 */
export async function recognizeReceiptJob(deps: {
  db: Db;
  recognizer: ReceiptRecognizer;
  payload: RecognizeReceiptPayload;
}): Promise<JobOutcome> {
  const { db, recognizer, payload } = deps;

  const rows = await db.select().from(receipts).where(eq(receipts.id, payload.receiptId)).limit(1);
  const receipt = rows[0];
  if (!receipt) return { kind: "skipped", reason: "單據已不存在" };

  // 已確認或已匯出的單據不再碰(鐵律 5:已匯出不可修改)
  if (receipt.status !== "pending_review") {
    return { kind: "skipped", reason: `單據狀態為 ${receipt.status},不覆寫已核對過的資料` };
  }
  if (!receipt.imagePath) {
    return markFailed(db, receipt.id, "單據沒有影像可辨識");
  }

  const mimeType = MIME_BY_EXT[path.extname(receipt.imagePath).toLowerCase()] ?? "image/jpeg";

  let imageBase64: string;
  try {
    imageBase64 = (await readFile(receipt.imagePath)).toString("base64");
  } catch {
    // 影像路徑相對於執行目錄;worker 與 web 的 cwd 不同時容易踩到,訊息要能指出方向
    return markFailed(
      db,
      receipt.id,
      `讀不到影像檔:${receipt.imagePath}(確認 worker 的 UPLOAD_DIR=${env.UPLOAD_DIR} 與 web 指向同一處)`,
    );
  }

  const activeCategories = await db
    .select({ id: categories.id, code: categories.code, name: categories.name })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder));

  let response;
  try {
    response = await recognizer.recognize({
      imageBase64,
      mimeType,
      prompt: buildRecognitionPrompt({
        categories: activeCategories,
        companyTaxId: env.COMPANY_TAX_ID,
      }),
      jsonSchema: buildRecognitionJsonSchema(activeCategories.map((c) => c.code)),
    });
  } catch (err) {
    if (err instanceof TransientRecognitionError) {
      return { kind: "transient", error: err.message };
    }
    return markFailed(db, receipt.id, (err as Error)?.message ?? "辨識失敗");
  }

  const result = normalizeRecognition(response.data, {
    categoryCodes: activeCategories.map((c) => c.code),
    companyTaxId: env.COMPANY_TAX_ID,
  });

  // 不論成敗都留下模型原始回傳,供日後追溯與調整提示詞
  const rawData = {
    provider: recognizer.id,
    model: response.model,
    usage: response.usage ?? null,
    response: response.data,
  };

  if (!result.ok) {
    await db
      .update(receipts)
      .set({
        recognitionStatus: "failed",
        recognitionError: result.error,
        rawData,
        updatedAt: new Date(),
      })
      .where(eq(receipts.id, receipt.id));
    return { kind: "failed", error: result.error };
  }

  const v = result.value;
  const categoryId = v.categoryCode
    ? (activeCategories.find((c) => c.code === v.categoryCode)?.id ?? null)
    : null;

  try {
    await db
      .update(receipts)
      .set({
        docType: v.docType,
        invoiceNumber: v.invoiceNumber,
        invoiceDate: v.invoiceDate,
        sellerName: v.sellerName,
        sellerTaxId: v.sellerTaxId,
        buyerTaxId: v.buyerTaxId,
        currency: v.currency,
        amount: v.amount,
        taxAmount: v.taxAmount,
        deductibility: v.deductibility,
        // 上傳者自己填的備註優先,AI 摘要只在空白時補上
        note: receipt.note ?? v.summary,
        categoryId: receipt.categoryId ?? categoryId,
        recognitionStatus: "succeeded",
        recognitionError: null,
        recognitionWarnings: v.warnings,
        rawData,
        updatedAt: new Date(),
      })
      .where(and(eq(receipts.id, receipt.id), eq(receipts.status, "pending_review")));
  } catch (err) {
    if (isUniqueViolation(err)) {
      // 發票號碼部分唯一索引擋下(鐵律 4):同一張發票已經入過帳
      return markFailed(
        db,
        receipt.id,
        `發票號碼 ${v.invoiceNumber} 已經存在,這張可能是重複上傳;請確認後刪除本筆`,
      );
    }
    throw err;
  }

  return { kind: "done" };
}
