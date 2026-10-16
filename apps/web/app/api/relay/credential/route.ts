import { signRelayCredential } from "@expense-receipts/auth/relay-credential";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * 發雲端中繼站的上傳憑證給已登入的使用者(ADR-0009)。
 *
 * 手機連得到本機時由 OfflineSync 自動呼叫,把憑證與中繼站網址存在手機上;
 * 之後連不到本機時,就拿它把照片送到中繼站。憑證**只能上傳**,不能讀中繼站的任何東西。
 *
 * 中繼站沒設定(RELAY_URL 留空)時回 `enabled: false`,手機會清掉舊憑證、
 * 退回 ADR-0008 的「存在手機、連得到本機再送」。
 *
 * 用 POST:這是「簽發」而不是「讀取」,也確保不會被任何一層快取住。
 */

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function POST(): Promise<Response> {
  const user = await getCurrentUser();
  // 回 401 而不是導向 /login:呼叫端是 fetch,拿到登入頁的 HTML 只會更混亂
  if (!user) return json({ error: "unauthorized" }, 401);

  if (!env.RELAY_URL) return json({ enabled: false }, 200);

  const issuedAt = Date.now();
  const credential = await signRelayCredential(env.RELAY_SECRET, user.id, issuedAt);
  return json({ enabled: true, relayUrl: env.RELAY_URL, credential, issuedAt }, 200);
}
