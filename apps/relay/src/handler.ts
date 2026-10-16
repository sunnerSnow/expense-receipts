import {
  checkRelayUpload,
  isUploadId,
  RELAY_META_HEADER,
  type RelayUploadMeta,
} from "@expense-receipts/core";
import { verifyRelayCredential } from "@expense-receipts/auth/relay-credential";

/**
 * 雲端中繼站的全部行為(ADR-0009)。
 *
 * 它只做收件與交件:**不辨識、不碰資料庫、沒有 Gemini 金鑰**。手機把照片送進來,
 * 本機 worker 開機時拉回去建單,建單成功才回來刪。
 *
 * 寫成 `handle(request, store, config)` 而不是直接綁 KV:測試可以在 Node 裡用
 * 記憶體版的 store 跑,不必啟動 workerd。KV 的接線在 index.ts。
 *
 * 兩把鑰匙,用途分開(conventions 7h):
 * - 上傳憑證(`RELAY_SECRET` 簽章):只能 `POST /uploads`
 * - 拉取權杖(`RELAY_PULL_TOKEN`):只能列出、取件、刪除
 */

export interface StoredUpload {
  id: string;
  /** null = metadata 讀不懂(不該發生,但交給 worker 記錄,不在這裡丟掉憑證) */
  meta: RelayUploadMeta | null;
}

export interface UploadStore {
  put(id: string, image: ArrayBuffer, meta: RelayUploadMeta): Promise<void>;
  list(cursor: string | null): Promise<{ items: StoredUpload[]; cursor: string | null }>;
  get(id: string): Promise<{ image: ArrayBuffer; meta: RelayUploadMeta | null } | null>;
  delete(id: string): Promise<void>;
}

export interface RelayConfig {
  relaySecret: string;
  pullToken: string;
  /** 允許上傳的網頁來源(本機 web 的網址,例如 Tailscale 的 https://xxx.ts.net) */
  allowedOrigins: string[];
  now?: () => number;
}

/** 密鑰太短等於沒設 —— 寧可整個關門,也不要用弱密鑰收件 */
export const MIN_SECRET_LENGTH = 32;

function json(body: unknown, status: number, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function bearer(req: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  return match?.[1]?.trim() || null;
}

/**
 * 常數時間比對兩個字串。
 *
 * 先各自 SHA-256 再逐位元組 XOR:雜湊讓兩邊長度一樣(不會從長度洩漏資訊),
 * XOR 累加不會提早結束。不用 Workers 專屬的 `crypto.subtle.timingSafeEqual`,
 * 是為了讓同一份程式在 Node 的測試裡也能跑。
 */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** 允許的來源才回 CORS 標頭;其他來源拿不到,瀏覽器就會擋下 */
function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

async function receive(req: Request, store: UploadStore, config: RelayConfig, now: number) {
  const credential = await verifyRelayCredential(config.relaySecret, bearer(req) ?? "", now);
  // 憑證過期、密鑰換過、或根本沒帶:手機要回到連得到本機的地方重新領
  if (!credential) return json({ error: "上傳憑證無效或已過期" }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "請求格式不正確" }, 400);
  }

  const image = form.get("image");
  if (!(image instanceof File)) return json({ error: "沒有影像" }, 400);

  const id = String(form.get("id") ?? "");
  const check = checkRelayUpload({
    id,
    mimeType: image.type,
    size: image.size,
    note: String(form.get("note") ?? ""),
  });
  if (!check.ok) return json({ error: check.error }, check.status);

  const meta: RelayUploadMeta = {
    // 經手人以憑證為準 —— 請求本文帶什麼身分都不採信
    uploaderId: credential.userId,
    mimeType: image.type,
    note: check.note,
    receivedAt: now,
  };

  try {
    // 同一個 id 重送是覆寫同一件,不會變成兩件(冪等)
    await store.put(id, await image.arrayBuffer(), meta);
  } catch (err) {
    // 最可能是 KV 免費額度的當日上限。回 5xx,手機會把照片留在佇列明天再送
    console.error(`[收件] ${id} 寫入失敗:${(err as Error)?.message ?? "未知錯誤"}`);
    return json({ error: "中繼站暫時無法收件,照片會留在手機稍後再送" }, 503);
  }

  return json({ ok: true, id }, 201);
}

async function pullList(url: URL, store: UploadStore) {
  const page = await store.list(url.searchParams.get("cursor"));
  return json(page, 200);
}

async function pullOne(id: string, store: UploadStore) {
  const found = await store.get(id);
  if (!found) return json({ error: "沒有這一件" }, 404);
  return new Response(found.image, {
    status: 200,
    headers: {
      "content-type": found.meta?.mimeType ?? "application/octet-stream",
      "cache-control": "no-store",
      [RELAY_META_HEADER]: encodeURIComponent(JSON.stringify(found.meta)),
    },
  });
}

export async function handle(req: Request, store: UploadStore, config: RelayConfig): Promise<Response> {
  const now = (config.now ?? Date.now)();
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, config.allowedOrigins);

  if (config.relaySecret.length < MIN_SECRET_LENGTH || config.pullToken.length < MIN_SECRET_LENGTH) {
    return json({ error: "中繼站尚未設定密鑰" }, 503, cors);
  }

  // 瀏覽器帶來的請求必須來自本機 web。CORS 本身只擋「讀回應」,
  // 這裡連寫入都擋;沒有 Origin 的(worker 拉取)不受影響
  if (origin && Object.keys(cors).length === 0) {
    return json({ error: "來源不允許" }, 403);
  }

  if (url.pathname === "/uploads") {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method === "POST") {
      const res = await receive(req, store, config, now);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    if (req.method === "GET") {
      if (!(await pullAuthorized(req, config))) return json({ error: "unauthorized" }, 401);
      return pullList(url, store);
    }
    return json({ error: "method not allowed" }, 405);
  }

  const match = /^\/uploads\/([^/]+)$/.exec(url.pathname);
  if (match) {
    const id = match[1] ?? "";
    if (!isUploadId(id)) return json({ error: "沒有這一件" }, 404);
    if (req.method !== "GET" && req.method !== "DELETE") {
      return json({ error: "method not allowed" }, 405);
    }
    if (!(await pullAuthorized(req, config))) return json({ error: "unauthorized" }, 401);
    if (req.method === "GET") return pullOne(id, store);
    // 刪除是冪等的:已經不在也回 204。只有本機確認建單成功後才會呼叫(鐵律 6)
    await store.delete(id);
    return new Response(null, { status: 204 });
  }

  return json({ error: "not found" }, 404);
}

async function pullAuthorized(req: Request, config: RelayConfig): Promise<boolean> {
  const token = bearer(req);
  return token !== null && (await sameSecret(token, config.pullToken));
}
