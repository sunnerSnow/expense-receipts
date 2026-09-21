import { getCurrentUser } from "@/lib/auth";
import { createAiReceiptRecord, receiptExists } from "@/lib/receipt-intake";

/**
 * 離線佇列的補送端點。
 *
 * 為什麼是 route handler 而不是沿用上傳頁的 server action:補送是程式在背景跑的,
 * 需要明確的 JSON 結果與冪等保證,而 server action 成功時會 `redirect()`。
 * 真正建立單據的邏輯兩邊共用 `createAiReceiptRecord`,不會走鐘。
 *
 * **冪等**:`id` 由客戶端在離線存檔當下產生,補送時原樣帶上來。網路斷在
 * 「伺服器已寫入、回應沒回到手機」這個縫隙時,客戶端會重送 —— 這時 id 已存在,
 * 回 `duplicate` 讓客戶端安心把它從佇列移除,不會變成兩筆單據。
 */

/** 只收影像;離線佇列不讓使用者填金額日期(那些交給 AI 辨識) */
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/** 與 next.config.ts 的 serverActions.bodySizeLimit 一致 */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  // 沒登入回 401 而不是導向 /login:呼叫端是 fetch,拿到登入頁的 HTML 只會更混亂
  if (!user) return json({ error: "unauthorized" }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "請求格式不正確" }, 400);
  }

  const id = String(form.get("id") ?? "");
  if (!UUID_RE.test(id)) return json({ error: "id 不是合法的 UUID" }, 400);

  const image = form.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return json({ error: "沒有影像" }, 400);
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return json({ error: `影像太大(上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB)` }, 413);
  }
  if (!ALLOWED_TYPES.has(image.type)) {
    return json({ error: `不支援的影像格式:${image.type || "(未知)"}` }, 415);
  }

  // 冪等:同一個 id 重送不會變成兩筆
  if (await receiptExists(id)) return json({ ok: true, id, duplicate: true }, 200);

  const noteRaw = String(form.get("note") ?? "").trim();

  try {
    await createAiReceiptRecord({
      id,
      uploaderId: user.id,
      image,
      mimeType: image.type,
      categoryId: null, // 離線時不選分類,由 AI 建議、回辦公室核對
      note: noteRaw === "" ? null : noteRaw,
    });
  } catch (err) {
    // 兩個程序同時補送同一筆時,existence 檢查可能都沒攔到 —— 主鍵會擋下來
    if (await receiptExists(id)) return json({ ok: true, id, duplicate: true }, 200);
    return json({ error: (err as Error)?.message ?? "建立失敗" }, 500);
  }

  return json({ ok: true, id, duplicate: false }, 201);
}
