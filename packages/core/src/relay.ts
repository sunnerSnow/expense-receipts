/**
 * 雲端中繼站(ADR-0009)的契約:web 的離線頁上傳、中繼站驗收、worker 拉回,
 * 三方共用這裡的規則與資料形狀。
 *
 * 放在 core 的理由:這些是「什麼樣的件可以收」的判斷,而三方跑在三種環境
 * (瀏覽器、Cloudflare Worker、Node)—— 只有零依賴的 core 三邊都能 import。
 */

/** 與上傳頁(serverActions.bodySizeLimit)、離線補送端點同一個上限 */
export const CAPTURE_MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** 只收影像。HEIC/HEIF 是 iPhone 從相簿選檔時會遇到的格式 */
export const CAPTURE_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

/**
 * 經中繼站送的備註上限(字元數)。
 *
 * 備註放在 KV 的 metadata 裡,而 metadata 序列化後上限 1024 bytes。中文一字
 * 3 bytes,200 字約 600 bytes,加上其他欄位仍有餘裕。備註是「誰請客、哪個案子」
 * 這種一句話的事,200 字綽綽有餘。
 */
export const RELAY_NOTE_MAX_LENGTH = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 客戶端產生的冪等鍵必須是 UUID —— 它同時是 KV key 與單據主鍵 */
export function isUploadId(id: string): boolean {
  return UUID_RE.test(id);
}

/** 取件時 metadata 放在這個回應標頭(URI 編碼的 JSON —— 備註有中文,標頭只能放 ASCII) */
export const RELAY_META_HEADER = "x-relay-meta";

/** 中繼站存在每一件旁邊的資訊(KV metadata) */
export interface RelayUploadMeta {
  /** 來自上傳憑證,不是請求本文 */
  uploaderId: string;
  mimeType: string;
  note: string | null;
  /** 中繼站收到的時間(毫秒) */
  receivedAt: number;
}

export type RelayUploadCheck =
  | { ok: true; note: string | null }
  | { ok: false; status: 400 | 413 | 415; error: string };

/**
 * 中繼站收件前的檢查。回傳的 `note` 是正規化過的(去頭尾空白,空字串變 null)。
 *
 * 狀態碼有語意:客戶端看到 4xx 會把這一件標成失敗、讓使用者自己處理,
 * 因為照片本身有問題,重送幾次都一樣(見 offline-queue 的 flushQueue)。
 */
export function checkRelayUpload(input: {
  id: string;
  mimeType: string;
  size: number;
  note: string;
}): RelayUploadCheck {
  if (!isUploadId(input.id)) return { ok: false, status: 400, error: "id 不是合法的 UUID" };
  if (input.size <= 0) return { ok: false, status: 400, error: "沒有影像" };
  if (input.size > CAPTURE_MAX_IMAGE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `影像太大(上限 ${CAPTURE_MAX_IMAGE_BYTES / 1024 / 1024}MB)`,
    };
  }
  if (!CAPTURE_IMAGE_TYPES.includes(input.mimeType)) {
    return { ok: false, status: 415, error: `不支援的影像格式:${input.mimeType || "(未知)"}` };
  }
  const note = input.note.trim();
  if (note.length > RELAY_NOTE_MAX_LENGTH) {
    return { ok: false, status: 400, error: `備註太長(上限 ${RELAY_NOTE_MAX_LENGTH} 字)` };
  }
  return { ok: true, note: note === "" ? null : note };
}

/**
 * 驗證從中繼站讀回來的 metadata。
 *
 * worker 拉回時用:KV 的 metadata 是 `unknown`,而建單要靠 uploaderId ——
 * 形狀不對就不建,交給呼叫端記錄下來,不要硬塞一筆沒有經手人的憑證。
 */
export function parseRelayUploadMeta(raw: unknown): RelayUploadMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.uploaderId !== "string" || r.uploaderId === "") return null;
  if (typeof r.mimeType !== "string" || !CAPTURE_IMAGE_TYPES.includes(r.mimeType)) return null;
  if (r.note !== null && typeof r.note !== "string") return null;
  if (typeof r.receivedAt !== "number" || !Number.isFinite(r.receivedAt)) return null;
  return {
    uploaderId: r.uploaderId,
    mimeType: r.mimeType,
    note: r.note === "" ? null : (r.note as string | null),
    receivedAt: r.receivedAt,
  };
}

/**
 * 手機佇列送出一件之後,依 HTTP 狀態決定這一件怎麼處理。本機與中繼站共用同一套規則:
 *
 * - `sent`:對方收下了(含「這個 id 已經收過」的 duplicate)→ 從手機佇列刪除
 * - `unauthorized`:沒登入 / 憑證失效 → 整輪停下,這時送什麼都一樣是 401
 * - `retry-later`:對方暫時收不了(5xx、限流、逾時)→ 整輪停下,**不算這張照片的錯**,
 *   下次再送。中繼站的 KV 當日額度用完就是這一類
 * - `rejected`:其他 4xx,照片本身有問題(格式、太大)→ 標成失敗讓使用者看到,
 *   繼續送下一件,不要讓一張壞照片卡住整條佇列
 */
export type UploadOutcome = "sent" | "unauthorized" | "retry-later" | "rejected";

export function classifyUploadResponse(status: number): UploadOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 401) return "unauthorized";
  if (status >= 500 || status === 408 || status === 429) return "retry-later";
  return "rejected";
}

/**
 * 上傳憑證多久換一次新的。
 *
 * 憑證效期 90 天,但「出差前打開一次 App」不會剛好在效期快到時 —— 每週換新,
 * 讓手機上的憑證幾乎總是新的,出門一個月也不會在半路失效。
 */
export const RELAY_CREDENTIAL_REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldRefreshRelayCredential(issuedAt: number | null, nowMs: number): boolean {
  if (issuedAt === null || !Number.isFinite(issuedAt)) return true;
  // 時鐘被調回去(issuedAt 在未來)也換一張,不要拿一張可能被中繼站拒收的憑證出門
  if (issuedAt > nowMs) return true;
  return nowMs - issuedAt >= RELAY_CREDENTIAL_REFRESH_AFTER_MS;
}
