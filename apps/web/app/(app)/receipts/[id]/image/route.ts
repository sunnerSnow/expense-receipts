import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { receipts } from "@expense-receipts/db";
import { resolveStoredFile } from "@expense-receipts/config";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";

// 憑證影像存在 UPLOAD_DIR(public/ 之外),經此 route 驗證登入後才回傳。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { id } = await params;
  const rows = await getDb()
    .select({ imagePath: receipts.imagePath })
    .from(receipts)
    .where(eq(receipts.id, id))
    .limit(1);

  const imagePath = rows[0]?.imagePath;
  if (!imagePath) return new Response("not found", { status: 404 });

  // DB 裡可能是相對鍵值(新)或某台機器上的絕對路徑(舊),都換算到目前的
  // UPLOAD_DIR;順帶擋掉路徑逃逸(見 ADR-0007)
  const resolved = resolveStoredFile(imagePath, env.UPLOAD_DIR);
  if (resolved === null) return new Response("not found", { status: 404 });

  try {
    const bytes = await readFile(resolved);
    const ext = resolved.split(".").pop()?.toLowerCase() ?? "";
    // 與上傳時的 extFromType 對應(HEIC 來自 iPhone 相簿)
    const type =
      { png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" }[ext] ??
      "image/jpeg";
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": type, "cache-control": "private, max-age=3600" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
