"use client";

import { useCallback, useEffect, useState } from "react";
import {
  enqueue,
  flushQueue,
  isOfflineQueueSupported,
  isServerReachable,
  listPending,
  remove,
  type PendingUpload,
} from "@/lib/offline-queue";

/** 顯示用的時間;刻意不用 toLocaleString,避免伺服器與瀏覽器對不起來 */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  // 不用 Math.round:小於 512 bytes 會變成「0 KB」,看起來像存壞了
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export function OfflineCapture() {
  const [supported, setSupported] = useState(true);
  /** null = 還在確認。這是「連不連得到伺服器」,不是 navigator.onLine */
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [items, setItems] = useState<PendingUpload[]>([]);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listPending());
    } catch (err) {
      setError((err as Error)?.message ?? "讀不到待送清單");
    }
  }, []);

  const probe = useCallback(async () => {
    setReachable(await isServerReachable());
  }, []);

  useEffect(() => {
    setSupported(isOfflineQueueSupported());
    void refresh();
    void probe();

    // 網路介面變化只是「該重新確認了」的提示,結論還是要問伺服器
    const recheck = () => void probe();
    window.addEventListener("online", recheck);
    window.addEventListener("offline", recheck);
    return () => {
      window.removeEventListener("online", recheck);
      window.removeEventListener("offline", recheck);
    };
  }, [refresh, probe]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await enqueue({ blob: file, mimeType: file.type || "image/jpeg", note: note.trim() });
      setFile(null);
      setNote("");
      // 清掉 file input 的選檔狀態
      (e.target as HTMLFormElement).reset();
      await refresh();
      setNotice(
        reachable
          ? "已存進待送清單。按「立即送出」或回到單據列表就會自動補送。"
          : "已存進手機。等連得到伺服器、打開這個 App 就會自動補送。",
      );
    } catch (err) {
      setError((err as Error)?.message ?? "存檔失敗");
    } finally {
      setBusy(false);
    }
  }

  async function onFlush() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await flushQueue();
      await refresh();
      await probe();
      if (r.sent > 0) setNotice(`已送出 ${r.sent} 筆,交給 AI 辨識中。`);
      if (r.error) setError(r.error);
      if (r.sent === 0 && !r.error) setNotice("沒有待送的單據。");
    } catch (err) {
      setError((err as Error)?.message ?? "補送失敗");
    } finally {
      setBusy(false);
    }
  }

  async function onDiscard(id: string) {
    setBusy(true);
    try {
      await remove(id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="banner banner-warn">
        這個瀏覽器不支援離線儲存(私密瀏覽模式常會關掉)。請改用一般視窗,
        或在有網路時用一般的「上傳」頁。
      </p>
    );
  }

  return (
    <>
      <p className={reachable === false ? "chip chip-warn" : reachable ? "chip chip-ok" : "chip"}>
        {reachable === null
          ? "確認連線中…"
          : reachable
            ? "連得到伺服器,可以直接送出"
            : "連不到伺服器 —— 照片會先存在手機裡"}
      </p>

      {notice ? <p className="ok-text">{notice}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <form onSubmit={onSave} className="card">
        <h2>拍一張收據</h2>
        <p className="small muted">
          不用填金額日期 —— 補送之後由 AI 辨識,回辦公室再核對。
          備註是只有你當下知道的事(誰請客、哪個案子),建議填。
        </p>

        <div className="field">
          <label htmlFor="off-image">單據影像</label>
          <input
            id="off-image"
            className="input"
            type="file"
            accept="image/*"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="field-hint">可以直接拍照,也可以從相簿選。</span>
        </div>

        <div className="field">
          <label htmlFor="off-note">備註</label>
          <input
            id="off-note"
            className="input"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例:客戶 A 晚餐"
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !file}>
          {busy ? "處理中…" : "存進待送清單"}
        </button>
      </form>

      <div className="row-between">
        <h2>待送出({items.length})</h2>
        {items.length > 0 ? (
          <button
            type="button"
            className="btn btn-sm"
            onClick={onFlush}
            disabled={busy || reachable !== true}
          >
            立即送出
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="muted small">目前沒有待送的單據。</p>
      ) : (
        <div className="list">
          {items.map((it) => (
            <div className="item" key={it.id}>
              <span className="item-title">{it.note || "(沒有備註)"}</span>
              <span className="item-amount small muted tnum">{formatSize(it.blob.size)}</span>
              <span className="item-meta">
                <span className="tnum">{formatTime(it.capturedAt)}</span>
                {it.attempts > 0 ? (
                  <span className="chip chip-danger">送出失敗 {it.attempts} 次</span>
                ) : null}
              </span>
              {it.lastError ? <span className="item-meta error-text">{it.lastError}</span> : null}
              <span className="item-meta">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onDiscard(it.id)}
                  disabled={busy}
                >
                  刪除
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
