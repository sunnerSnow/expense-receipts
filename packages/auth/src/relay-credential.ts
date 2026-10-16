/**
 * 雲端中繼站的上傳憑證(ADR-0009)。
 *
 * 手機連得到本機時向 web 領一張,之後拿它把照片送到中繼站;中繼站用同一把
 * `RELAY_SECRET` 驗章,uploader 一律以憑證裡的 userId 為準。
 *
 * **只用 WebCrypto,不 import `node:crypto`**:簽章在 web(Node)、驗章在
 * Cloudflare Worker,兩邊共用這一份。這也是它放在獨立子路徑
 * (`@expense-receipts/auth/relay-credential`)的原因 —— 從 package 根目錄
 * import 會連帶拉進 scrypt 用的 `node:crypto`。
 *
 * 刻意不共用 `SESSION_SECRET`:中繼站在第三方平台上,`RELAY_SECRET` 外洩的最壞
 * 情況是「有人往中繼站塞照片」(都會落在 pending_review);共用的話就變成
 * 「可以偽造任何人的登入」。
 *
 * 格式:base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload 的 base64url))
 */

/** 憑證效期。手機遺失時靠換 `RELAY_SECRET` 作廢,效期只是兜底 */
export const RELAY_CREDENTIAL_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** 容許的時鐘誤差:手機、本機、Cloudflare 的時間不會完全一致 */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const VERSION = 1;

interface Payload {
  v: number;
  /** userId */
  sub: string;
  /** 簽發時間(毫秒) */
  iat: number;
}

export interface RelayCredential {
  userId: string;
  issuedAt: number;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 不是合法 base64url 時回傳 null,不丟例外。
 *
 * 回傳型別明確標成 `Uint8Array<ArrayBuffer>`:TS 5.7 起 DOM 的 `BufferSource`
 * 不收 `Uint8Array<ArrayBufferLike>`(可能是 SharedArrayBuffer)—— 在 web 的
 * DOM 型別下編譯時,`crypto.subtle.verify` 會拒收沒標的版本。
 */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// 回傳型別交給推斷:Node 的型別定義沒有全域的 CryptoKey(只有 webcrypto.CryptoKey),
// Workers 的則有 —— 寫死哪一邊都會讓另一邊編不過
function importKey(secret: string, usage: "sign" | "verify") {
  // 空密鑰簽出來的憑證任何人都能偽造 —— 寧可直接爆掉,也不要靜默發出去
  if (secret.length === 0) throw new Error("RELAY_SECRET 未設定");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signRelayCredential(
  secret: string,
  userId: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const payload: Payload = { v: VERSION, sub: userId, iat: nowMs };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importKey(secret, "sign");
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${toBase64Url(sig)}`;
}

/**
 * 驗證憑證,回傳 userId 與簽發時間;任何問題一律回 null(不丟例外)。
 *
 * 比對簽章用 `crypto.subtle.verify` 而不是自己比字串:它是常數時間比較,
 * 不會從回應時間洩漏簽章對了幾個位元組。
 */
export async function verifyRelayCredential(
  secret: string,
  token: string,
  nowMs: number = Date.now(),
): Promise<RelayCredential | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sigText] = parts as [string, string];

  const sig = fromBase64Url(sigText);
  if (!sig || sig.length === 0) return null;

  const key = await importKey(secret, "verify");
  const ok = await crypto.subtle.verify("HMAC", key, sig, encoder.encode(body));
  if (!ok) return null;

  const raw = fromBase64Url(body);
  if (!raw) return null;

  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as Partial<Payload>;
  } catch {
    return null;
  }

  if (payload.v !== VERSION) return null;
  if (typeof payload.sub !== "string" || payload.sub === "") return null;
  if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) return null;
  // 未來時間簽發的憑證:不是時鐘誤差就是被動過,一律不收
  if (payload.iat - nowMs > CLOCK_SKEW_MS) return null;
  if (nowMs - payload.iat > RELAY_CREDENTIAL_MAX_AGE_MS) return null;

  return { userId: payload.sub, issuedAt: payload.iat };
}
