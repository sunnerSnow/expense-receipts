import "server-only";

import {
  createAiReceiptRecord as createWithDeps,
  receiptExists as existsIn,
  saveReceiptImage as saveTo,
  type AiReceiptInput,
  type IntakeDeps,
} from "@expense-receipts/intake";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { sendRecognizeJob } from "@/lib/queue";

/**
 * web 端的建單入口:把 web 自己的 DB 連線、影像目錄、派工函式綁進
 * `@expense-receipts/intake`。
 *
 * 邏輯本身在 package 裡 —— worker 從雲端中繼站拉回的件也走同一份(ADR-0009),
 * 這裡只負責接線,上傳頁與補送端點的呼叫方式不必改。
 */
function deps(): IntakeDeps {
  return { db: getDb(), uploadDir: env.UPLOAD_DIR, sendRecognizeJob };
}

/** 影像落地,回傳存進資料庫的相對鍵值(ADR-0007) */
export function saveReceiptImage(image: Blob, id: string, mimeType: string): Promise<string> {
  return saveTo(env.UPLOAD_DIR, image, id, mimeType);
}

/** 建立一筆待 AI 辨識的單據(鐵律 3:一律 pending_review) */
export function createAiReceiptRecord(input: AiReceiptInput): Promise<void> {
  return createWithDeps(deps(), input);
}

/** 這個 id 是不是已經收過了(離線補送的冪等判斷) */
export function receiptExists(id: string): Promise<boolean> {
  return existsIn(getDb(), id);
}
