/**
 * 離線待送佇列(瀏覽器端,IndexedDB)。
 *
 * 為什麼是 IndexedDB 而不是 localStorage:要存的是照片(數 MB 的 Blob),
 * localStorage 只能放字串而且上限約 5MB,一張就爆。IndexedDB 可以直接存 Blob。
 *
 * 為什麼不用 Background Sync API:**iOS Safari 不支援**。使用者主力是 iPhone,
 * 所以改成「開啟 App 時如果連得上就自動補送」—— 這在所有瀏覽器都成立,
 * 代價是要打開 App 才會送出,而那正好是回辦公室時會做的事。
 */

const DB_NAME = "expense-receipts-offline";
const DB_VERSION = 1;
const STORE = "pending-uploads";

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

export interface FlushResult {
  sent: number;
  failed: number;
  /** 沒送成功時的第一個原因,給畫面顯示 */
  error: string | null;
}

/**
 * 把佇列裡的單據依序補送出去。
 *
 * 刻意**序列**而不是並行:每筆是幾 MB 的照片,行動網路上並行只會互相拖慢,
 * 而且更容易撞到伺服器端的體積上限與 AI 辨識的每分鐘限流。
 *
 * 401 視為「還沒登入」直接中止整輪 —— 繼續送只會累積無意義的失敗次數。
 */
export async function flushQueue(): Promise<FlushResult> {
  if (!isOfflineQueueSupported()) return { sent: 0, failed: 0, error: null };

  const items = await listPending();
  let sent = 0;
  let failed = 0;
  let firstError: string | null = null;

  for (const item of items) {
    const form = new FormData();
    form.set("id", item.id);
    form.set("note", item.note);
    form.set("image", new File([item.blob], `${item.id}`, { type: item.mimeType }));

    let response: Response;
    try {
      response = await fetch("/api/receipts/offline", { method: "POST", body: form });
    } catch (err) {
      // 網路不通:不算這筆的錯,整輪停下來等下次
      firstError ??= (err as Error)?.message ?? "連不到伺服器";
      failed += 1;
      break;
    }

    if (response.ok) {
      await remove(item.id);
      sent += 1;
      continue;
    }

    if (response.status === 401) {
      firstError ??= "請先登入再補送";
      failed += 1;
      break;
    }

    let message = `伺服器回應 ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // 回應不是 JSON 就沿用狀態碼訊息
    }

    // 4xx 是這張照片本身的問題(格式、太大),重送幾次都一樣 —— 記錄下來讓
    // 使用者看到並手動刪除,不要無聲卡住整條佇列
    await markFailed(item, message);
    failed += 1;
    firstError ??= message;
  }

  return { sent, failed, error: firstError };
}
