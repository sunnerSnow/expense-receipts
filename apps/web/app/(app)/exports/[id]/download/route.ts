import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { exportBatches } from "@expense-receipts/db";
import { exportFileName } from "@expense-receipts/core";
import { resolveStoredFile } from "@expense-receipts/config";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * 下載匯出檔(CSV 或影像 zip)。
 *
 * 路徑取自 DB 而非 query,且下載前再確認檔案落在 EXPORT_DIR 之內 ——
 * 避免任何情況下把伺服器上其他檔案讀出來。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { id } = await params;
  const which = new URL(req.url).searchParams.get("file") === "zip" ? "zip" : "csv";

  const rows = await getDb()
    .select({
      filePath: exportBatches.filePath,
      imageZipPath: exportBatches.imageZipPath,
      periodYear: exportBatches.periodYear,
      periodMonth: exportBatches.periodMonth,
    })
    .from(exportBatches)
    .where(eq(exportBatches.id, id))
    .limit(1);

  const batch = rows[0];
  if (!batch) return new Response("not found", { status: 404 });

  const filePath = which === "zip" ? batch.imageZipPath : batch.filePath;
  if (!filePath) return new Response("not found", { status: 404 });

  // DB 裡可能是相對鍵值(新)或某台機器上的絕對路徑(舊),都換算到目前的
  // EXPORT_DIR;解析不出來或會逃出根目錄一律拒絕(見 ADR-0007)
  const resolved = resolveStoredFile(filePath, env.EXPORT_DIR);
  if (resolved === null) return new Response("forbidden", { status: 403 });

  let bytes: Buffer;
  try {
    bytes = await readFile(resolved);
  } catch {
    return new Response("匯出檔已不存在", { status: 404 });
  }

  const downloadName = exportFileName(batch.periodYear, batch.periodMonth, which);

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": which === "zip" ? "application/zip" : "text/csv; charset=utf-8",
      // 中文檔名用 RFC 5987 的 filename*,舊瀏覽器 fallback 到 ASCII 名
      "content-disposition":
        `attachment; filename="export-${batch.periodYear}-${String(batch.periodMonth).padStart(2, "0")}.${which}"; ` +
        `filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      "cache-control": "private, no-store",
    },
  });
}
