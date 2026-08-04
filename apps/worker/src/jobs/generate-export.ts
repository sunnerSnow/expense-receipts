import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
// archiver 8 是純 ESM 並改用具名 class,沒有舊版的 archiver('zip') 工廠函式
import { ZipArchive } from "archiver";
import { and, asc, eq, gte, isNull, lt, inArray } from "drizzle-orm";
import { categories, exportBatches, receipts, users, type Db } from "@expense-receipts/db";
import {
  buildExportRows,
  canTransitionStatus,
  exportFileName,
  toCsv,
  type ExportBundle,
  type ReceiptForExport,
} from "@expense-receipts/core";
import type { GenerateExportPayload } from "@expense-receipts/queue";
import { env } from "../env";

export type ExportOutcome =
  | { kind: "done"; batchId: string; count: number; csvPath: string; zipPath: string | null }
  | { kind: "empty" }
  | { kind: "conflict"; message: string };

/** 該期間的日期區間([start, next)) */
function monthBounds(year: number, month: number): { start: string; next: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { start, next };
}

/** 把影像打包成 zip;沒有任何影像時回 null(不產生空 zip) */
async function writeImageZip(bundle: ExportBundle, zipPath: string): Promise<string | null> {
  const withImage = bundle.rows.filter((r) => r.imagePath !== null && r.imageFileName !== "");
  if (withImage.length === 0) return null;

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const out = createWriteStream(zipPath);

  for (const row of withImage) {
    // 檔名用清單的流水號前綴,會計看第 007 列就找 007 開頭那張
    archive.file(row.imagePath as string, { name: row.imageFileName });
  }
  // finalize 不要 await 在 pipeline 之前,否則資料寫不進串流
  const done = pipeline(archive, out);
  await archive.finalize();
  await done;
  return zipPath;
}

/**
 * 產生某期間的月結匯出。
 *
 * 鐵律 5 的落實方式:
 * - `export_batches` 只 INSERT —— 先把檔案產出來,再插入帶路徑的批次紀錄
 * - 批次紀錄與「單據轉 exported」在**同一個交易**內,不會出現
 *   「單據標記已匯出但查不到批次」或反之
 * - 狀態轉換一律問過 core 的 `canTransitionStatus()`
 */
export async function generateExportJob(deps: {
  db: Db;
  payload: GenerateExportPayload;
}): Promise<ExportOutcome> {
  const { db, payload } = deps;
  const { periodYear: year, periodMonth: month } = payload;
  const { start, next } = monthBounds(year, month);

  // 只撈已確認且還沒被任何批次帶走的單據
  const rows = await db
    .select({
      id: receipts.id,
      invoiceDate: receipts.invoiceDate,
      docType: receipts.docType,
      invoiceNumber: receipts.invoiceNumber,
      sellerName: receipts.sellerName,
      sellerTaxId: receipts.sellerTaxId,
      buyerTaxId: receipts.buyerTaxId,
      currency: receipts.currency,
      amount: receipts.amount,
      taxAmount: receipts.taxAmount,
      deductibility: receipts.deductibility,
      categoryName: categories.name,
      uploaderName: users.name,
      note: receipts.note,
      imagePath: receipts.imagePath,
      status: receipts.status,
    })
    .from(receipts)
    .leftJoin(categories, eq(receipts.categoryId, categories.id))
    .leftJoin(users, eq(receipts.uploaderId, users.id))
    .where(
      and(
        eq(receipts.status, "confirmed"),
        isNull(receipts.exportBatchId),
        gte(receipts.invoiceDate, start),
        lt(receipts.invoiceDate, next),
      ),
    )
    .orderBy(asc(receipts.invoiceDate));

  if (rows.length === 0) return { kind: "empty" };

  // 轉換合法性由 core 判斷(這裡全部是 confirmed,但不繞過唯一出口)
  const illegal = rows.find((r) => !canTransitionStatus(r.status, "exported"));
  if (illegal) {
    return { kind: "conflict", message: `單據 ${illegal.id} 狀態為 ${illegal.status},無法匯出` };
  }

  const bundle = buildExportRows(rows as ReceiptForExport[]);

  const dir = path.join(env.EXPORT_DIR, `${year}-${String(month).padStart(2, "0")}`);
  await mkdir(dir, { recursive: true });
  const csvPath = path.join(dir, exportFileName(year, month, "csv"));
  const zipTarget = path.join(dir, exportFileName(year, month, "zip"));

  await writeFile(csvPath, toCsv(bundle), "utf8");
  const zipPath = await writeImageZip(bundle, zipTarget);

  const ids = bundle.rows.map((r) => r.receiptId);

  // 檔案已就緒 → 批次紀錄與狀態轉換一起進交易
  const batchId = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(exportBatches)
      .values({
        periodYear: year,
        periodMonth: month,
        createdBy: payload.createdBy,
        filePath: csvPath,
        imageZipPath: zipPath,
        receiptCount: bundle.count,
        currencyTotals: bundle.currencyTotals,
      })
      .returning({ id: exportBatches.id });

    const batch = inserted[0];
    if (!batch) throw new Error("匯出批次寫入失敗");

    const updated = await tx
      .update(receipts)
      .set({ status: "exported", exportBatchId: batch.id, updatedAt: new Date() })
      // 再次以 confirmed 為條件:期間內若有人剛好改了狀態,這裡會少更新
      .where(and(inArray(receipts.id, ids), eq(receipts.status, "confirmed")))
      .returning({ id: receipts.id });

    if (updated.length !== ids.length) {
      // 交易回滾:寧可整批失敗重跑,也不要清單與實際入帳不一致
      throw new Error(
        `匯出過程中有單據狀態被變更(預期 ${ids.length} 筆、實際 ${updated.length} 筆),已取消這次匯出,請重試`,
      );
    }

    return batch.id;
  });

  return { kind: "done", batchId, count: bundle.count, csvPath, zipPath };
}
