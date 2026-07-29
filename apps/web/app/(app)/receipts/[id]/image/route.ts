import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { receipts } from "@expense-receipts/db";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

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

  try {
    const bytes = await readFile(imagePath);
    const ext = imagePath.split(".").pop()?.toLowerCase();
    const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": type, "cache-control": "private, max-age=3600" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
