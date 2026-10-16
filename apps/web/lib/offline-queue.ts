import {
  classifyUploadResponse,
  shouldRefreshRelayCredential,
} from "@expense-receipts/core";

/**
 * 離線待送佇列(瀏覽器端,IndexedDB)。
 *
 * 為什麼是 IndexedDB 而不是 localStorage:要存的是照片(數 MB 的 Blob),
 * localStorage 只能放字串而且上限約 5MB,一張就爆。IndexedDB 可以直接存 Blob。
 *
 * 為什麼不用 Background Sync API:**iOS Safari 不支援**。使用者主力是 iPhone,
 * 所以改成「存檔當下、以及開啟 App 時,能送就送」—— 這在所有瀏覽器都成立。
 *
 * 送去哪(ADR-0009):連得到本機 → 本機;連不到但手機上有中繼站憑證 → 雲端中繼站;
 * 都不行 → 留在佇列。**存檔一律先進佇列,送達才刪**,不論目的地是哪一個。
 */

const DB_NAME = "expense-receipts-offline";
const DB_VERSION = 1;
const STORE = "pending-uploads";

/** 單筆上傳的逾時:15MB 在慢速行動網路上也要送得完,但不能無限等 */
const UPLOAD_TIMEOUT_MS = 120_000;

/** 佇列裡的一筆待送單據 */
export interface PendingUpload {
  /** 存檔當下就產生的 UUID,補送時原樣帶給伺服器當冪等鍵 */
  id: string;
  blob: Blob;
  mimeType: string;
  note: string;
  /** 拍照/存檔時間(顯示用) */
  capturedAt: number;
  /** 補送失敗次數,連續失敗時顯示給使用者看 */
  attempts: number;
  /** 最後一次失敗原因 */
  lastError: string | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("開不了 IndexedDB"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB 操作失敗"));
        transaction.oncomplete = () => db.close();
      }),
  );
}

/** 支不支援(私密瀏覽或舊瀏覽器可能沒有) */
export function isOfflineQueueSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * 伺服器連不連得到。
 *
 * **不要只看 `navigator.onLine`** —— 它回報的是「這台裝置有沒有網路介面」。
 * 這套系統最常見的離線情境正好是「手機有 4G、但辦公室那台電腦沒開」,
 * 那時 onLine 是 true 但什麼都送不出去。onLine 為 false 時可以直接判定離線
 * (省一次注定失敗的請求),true 的時候還是要真的問一次伺服器。
 */
export async function isServerReachable(timeoutMs = 4000): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  try {
    const res = await fetch("/api/ping", {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 雲端中繼站的上傳憑證(ADR-0009)
//
// 存 localStorage 而不是 IndexedDB:它是一小段字串,同步讀寫比較單純。
// 憑證只能上傳、不能讀中繼站的任何東西;手機遺失時靠換 RELAY_SECRET 作廢。
// ---------------------------------------------------------------------------

const RELAY_KEY = "expense-receipts-relay";

export interface RelayConfig {
  relayUrl: string;
  credential: string;
  issuedAt: number;
}

/**
 * - `enabled`:手機上有可用的憑證
 * - `disabled`:本機明確說沒有設定中繼站(RELAY_URL 留空)
 * - `unknown`:還沒問過本機,或憑證被中繼站退回而清掉了
 */
export type RelayState =
  | { status: "enabled"; config: RelayConfig }
  | { status: "disabled" }
  | { status: "unknown" };

export function getRelayState(): RelayState {
  try {
    const raw = localStorage.getItem(RELAY_KEY);
    if (!raw) return { status: "unknown" };
    const parsed = JSON.parse(raw) as Partial<RelayConfig> & { enabled?: boolean };
    if (parsed.enabled === false) return { status: "disabled" };
    if (
      typeof parsed.relayUrl === "string" &&
      typeof parsed.credential === "string" &&
      typeof parsed.issuedAt === "number"
    ) {
      return {
        status: "enabled",
        config: { relayUrl: parsed.relayUrl, credential: parsed.credential, issuedAt: parsed.issuedAt },
      };
    }
  } catch {
    // 私密瀏覽或內容壞掉:當作還沒領過
  }
  return { status: "unknown" };
}

function writeRelayState(value: object | null): void {
  try {
    if (value === null) localStorage.removeItem(RELAY_KEY);
    else localStorage.setItem(RELAY_KEY, JSON.stringify(value));
  } catch {
    // 寫不進去就只是用不了中繼站,佇列本身照常運作
  }
}

/**
 * 連得到本機時呼叫:沒有憑證、或憑證已滿一週,就向本機領一張新的。
 *
 * 失敗一律靜默:這是「順手更新」,不該打斷使用者正在做的事。
 * 沒登入(401)時保留舊的 —— 舊憑證可能還有效,清掉反而讓人送不出去。
 */
export async function refreshRelayCredential(force = false): Promise<RelayState> {
  const current = getRelayState();
  const issuedAt = current.status === "enabled" ? current.config.issuedAt : null;
  if (!force && current.status !== "unknown" && !shouldRefreshRelayCredential(issuedAt, Date.now())) {
    return current;
  }

  try {
    const res = await fetch("/api/relay/credential", { method: "POST", cache: "no-store" });
    if (!res.ok) return current;
    const body = (await res.json()) as
      | { enabled: false }
      | { enabled: true; relayUrl: string; credential: string; issuedAt: number };
    if (!body.enabled) {
      writeRelayState({ enabled: false });
    } else {
      writeRelayState({ relayUrl: body.relayUrl, credential: body.credential, issuedAt: body.issuedAt });
    }
  } catch {
    return current;
  }
  return getRelayState();
}

// ---------------------------------------------------------------------------
// 佇列操作
// ---------------------------------------------------------------------------

export async function enqueue(item: {
  blob: Blob;
  mimeType: string;
  note: string;
}): Promise<PendingUpload> {
  const record: PendingUpload = {
    id: crypto.randomUUID(),
    blob: item.blob,
    mimeType: item.mimeType,
    note: item.note,
    capturedAt: Date.now(),
    attempts: 0,
    lastError: null,
  };
  await tx("readwrite", (store) => store.add(record));
  return record;
}

export async function listPending(): Promise<PendingUpload[]> {
  const all = await tx<PendingUpload[]>("readonly", (store) => store.getAll());
  return all.sort((a, b) => a.capturedAt - b.capturedAt);
}

export async function countPending(): Promise<number> {
  return tx<number>("readonly", (store) => store.count());
}

export async function remove(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
}

async function markFailed(item: PendingUpload, error: string): Promise<void> {
  await tx("readwrite", (store) =>
    store.put({ ...item, attempts: item.attempts + 1, lastError: error }),
  );
}

/** 這一輪送去哪 */
export type Destination = { kind: "server" } | { kind: "relay"; config: RelayConfig };

/**
 * 決定目的地:本機優先,其次中繼站,都不行就回 null(留在佇列)。
 *
 * 本機優先的理由:送到本機會立刻進 AI 辨識;送到中繼站還要等 worker 拉回。
 * 呼叫端已經探測過本機時把結果傳進來,省一次請求。
 */
export async function pickDestination(serverReachable?: boolean): Promise<Destination | null> {
  if (serverReachable ?? (await isServerReachable())) return { kind: "server" };
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;
  const relay = getRelayState();
  return relay.status === "enabled" ? { kind: "relay", config: relay.config } : null;
}

export interface FlushResult {
  sent: number;
  failed: number;
  /** 沒送成功時的第一個原因,給畫面顯示 */
  error: string | null;
  /** 這一輪送去哪;null = 哪裡都送不到,全部留在佇列 */
  destination: Destination["kind"] | null;
}

function send(item: PendingUpload, dest: Destination): Promise<Response> {
  const form = new FormData();
  form.set("id", item.id);
  form.set("note", item.note);
  form.set("image", new File([item.blob], `${item.id}`, { type: item.mimeType }));
  const signal = AbortSignal.timeout(UPLOAD_TIMEOUT_MS);

  if (dest.kind === "server") {
    return fetch("/api/receipts/offline", { method: "POST", body: form, signal });
  }
  return fetch(`${dest.config.relayUrl}/uploads`, {
    method: "POST",
    body: form,
    headers: { authorization: `Bearer ${dest.config.credential}` },
    signal,
  });
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // 回應不是 JSON 就沿用狀態碼訊息
  }
  return `伺服器回應 ${response.status}`;
}

/**
 * 把佇列裡的單據依序送出去。目的地沒給就自己決定(見 pickDestination)。
 *
 * 刻意**序列**而不是並行:每筆是幾 MB 的照片,行動網路上並行只會互相拖慢,
 * 而且更容易撞到伺服器端的體積上限與 AI 辨識的每分鐘限流。
 *
 * 每一件的處理依 core 的 `classifyUploadResponse`:送達才刪;401 與暫時性失敗
 * 整輪停下;照片本身有問題的標成失敗、繼續送下一件。
 */
export async function flushQueue(destination?: Destination | null): Promise<FlushResult> {
  if (!isOfflineQueueSupported()) return { sent: 0, failed: 0, error: null, destination: null };

  const items = await listPending();
  if (items.length === 0) return { sent: 0, failed: 0, error: null, destination: null };

  const dest = destination === undefined ? await pickDestination() : destination;
  if (!dest) return { sent: 0, failed: 0, error: null, destination: null };

  let sent = 0;
  let failed = 0;
  let firstError: string | null = null;

  for (const item of items) {
    let response: Response;
    try {
      response = await send(item, dest);
    } catch (err) {
      // 網路不通或逾時:不算這筆的錯,整輪停下來等下次
      firstError ??= (err as Error)?.message ?? "連不到伺服器";
      failed += 1;
      break;
    }

    const outcome = classifyUploadResponse(response.status);

    if (outcome === "sent") {
      await remove(item.id);
      sent += 1;
      continue;
    }

    if (outcome === "unauthorized") {
      if (dest.kind === "relay") {
        // 憑證過期或密鑰換過:清掉,下次連得到本機時會自動領新的
        writeRelayState(null);
        firstError ??= "中繼站的上傳憑證失效了。回到連得到辦公室電腦的地方打開 App 一次就會更新";
      } else {
        firstError ??= "請先登入再補送";
      }
      failed += 1;
      break;
    }

    const message = await errorMessage(response);

    if (outcome === "retry-later") {
      // 對方暫時收不了(例如中繼站當日額度用完):照片留著,下次再送
      firstError ??= message;
      failed += 1;
      break;
    }

    // rejected:照片本身的問題,重送幾次都一樣 —— 記錄下來讓使用者看到並手動刪除,
    // 不要無聲卡住整條佇列
    await markFailed(item, message);
    failed += 1;
    firstError ??= message;
  }

  return { sent, failed, error: firstError, destination: dest.kind };
}
