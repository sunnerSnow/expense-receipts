/**
 * 「收單據進來」的唯一入口(只給 Node 端用)。
 *
 * 為什麼獨立成一個 package:建立 AI 辨識單據有三條路 —— 上傳頁的 server action、
 * 離線佇列的補送端點(都在 web),以及從雲端中繼站拉回的件(worker,ADR-0009)。
 * apps 之間不能互相 import;三條路如果各寫一份,遲早會有一邊忘了設 `status`、
 * 忘了派工、或忘了派工失敗要寫回 DB,而那些都是鐵律。
 *
 * 不放 `packages/core`:這裡要寫檔、寫 DB,core 禁止任何 IO。
 * DB 連線、影像目錄、派工函式都由呼叫端注入 —— web 與 worker 各有自己的連線池
 * 與 pg-boss 實例。
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { receipts, type Db } from "@expense-receipts/db";
import type { RecognizeReceiptPayload } from "@expense-receipts/queue";

export interface IntakeDeps {
  db: Db;
  /** 影像目錄,必須是 `resolveFromRepoRoot()` 解析過的值(web 與 worker 才會指向同一處) */
  uploadDir: string;
  /** 派送 AI 辨識工作。派不出去要丟例外,這裡會把失敗寫回 DB */
  sendRecognizeJob: (payload: RecognizeReceiptPayload) => Promise<unknown>;
}

export interface AiReceiptInput {
  /** 由呼叫端決定:離線補送與中繼拉回都拿客戶端產生的 UUID 當冪等鍵 */
  id: string;
  uploaderId: string;
  image: Blob;
  mimeType: string;
  categoryId: string | null;
  note: string | null;
}

/**
 * MIME → 副檔名。
 *
 * 副檔名不只是裝飾:worker 是靠它決定送給 Gemini 的 mimeType(見
 * jobs/recognize-receipt.ts 的 MIME_BY_EXT)。從相簿選檔會遇到 iPhone 的
 * HEIC,若一律當成 jpg,worker 就會拿 image/jpeg 的標頭送 HEIC 的位元組。
 */
export function extFromType(type: string): string {
  switch (type) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "jpg";
  }
}

/**
 * 影像落地;回傳**存進資料庫的鍵值**(相對於 uploadDir,不是絕對路徑)。
 *
 * 存鍵值而不是絕對路徑:專案換位置(換電腦、換使用者名稱、搬進容器)之後,
 * 絕對路徑會全部失效 —— 而影像是報帳憑證,讀不到等於憑證遺失。見 ADR-0007。
 */
export async function saveReceiptImage(
  uploadDir: string,
  image: Blob,
  id: string,
  mimeType: string,
): Promise<string> {
  const key = `${id}.${extFromType(mimeType)}`;
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, key), Buffer.from(await image.arrayBuffer()));
  return key;
}

/**
 * 建立一筆待 AI 辨識的單據:先落地影像 + 建空殼,再派工給 worker。
 *
 * 為什麼先建空殼:job payload 只帶 receiptId,worker 靠它找影像與寫回結果;
 * 而且使用者上傳完就能在列表看到「辨識中」,不用停在上傳頁等。
 * 金額先放 0 —— 它是 NOT NULL,而 recognition_status='queued' 才是「還沒有資料」
 * 的真正判準,確認入帳會被擋住(見 confirmReceipt)。
 *
 * 鐵律 3:一律落在 pending_review,不得直接 confirmed。
 */
export async function createAiReceiptRecord(deps: IntakeDeps, input: AiReceiptInput): Promise<void> {
  const imagePath = await saveReceiptImage(deps.uploadDir, input.image, input.id, input.mimeType);

  await deps.db.insert(receipts).values({
    id: input.id,
    uploaderId: input.uploaderId,
    context: "company",
    docType: "other", // 佔位,辨識後由 worker 更正
    source: "ai",
    status: "pending_review",
    currency: "TWD",
    amount: "0",
    categoryId: input.categoryId,
    note: input.note,
    imagePath,
    recognitionStatus: "queued",
  });

  try {
    await deps.sendRecognizeJob({ receiptId: input.id });
  } catch (err) {
    // 派工失敗要寫回 DB,否則單據會永遠停在「辨識中」查不出原因
    await deps.db
      .update(receipts)
      .set({
        recognitionStatus: "failed",
        recognitionError: `辨識工作派送失敗:${(err as Error)?.message ?? "未知錯誤"}`,
      })
      .where(eq(receipts.id, input.id));
  }
}

/** 這個 id 是不是已經收過了(離線補送與中繼拉回的冪等判斷) */
export async function receiptExists(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(eq(receipts.id, id))
    .limit(1);
  return rows.length > 0;
}
