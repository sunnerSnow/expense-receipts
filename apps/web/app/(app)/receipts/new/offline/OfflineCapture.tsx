"use client";

import { useCallback, useEffect, useState } from "react";
import { RELAY_NOTE_MAX_LENGTH } from "@expense-receipts/core";
import {
  enqueue,
  flushQueue,
  getRelayState,
  isOfflineQueueSupported,
  isServerReachable,
  listPending,
  pickDestination,
  refreshRelayCredential,
  remove,
  type Destination,
  type FlushResult,
  type PendingUpload,
  type RelayState,
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

/** 送出成功時給使用者看的話:送到哪裡,接下來會發生什麼 */
function sentNotice(r: FlushResult): string {
  return r.destination === "relay"
    ? `已把 ${r.sent} 筆送到雲端中繼站,辦公室電腦開機後會自動進來辨識。`
    : `已送出 ${r.sent} 筆,交給 AI 辨識中。`;
}

/**
 * 連線狀態:
 * - null:還在確認
 * - Destination:這一刻存檔會送去哪(本機或中繼站)
 * - "none":哪裡都送不到,只能先存在手機
 */
type Reach = Destination | "none" | null;

export function OfflineCapture() {
  const [supported, setSupported] = useState(true);
  const [reach, setReach] = useState<Reach>(null);
  const [relay, setRelay] = useState<RelayState>({ status: "unknown" });
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

  /** 問本機在不在;在的話順手更新中繼站憑證,再決定這一刻的目的地 */
  const probe = useCallback(async (): Promise<Destination | null> => {
    const reachable = await isServerReachable();
    setRelay(reachable ? await refreshRelayCredential() : getRelayState());
    const dest = await pickDestination(reachable);
    setReach(dest ?? "none");
    return dest;
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

  /** 送出佇列並把結果翻成畫面上的話 */
  async function flushAndReport(dest: Destination | null, savedJustNow: boolean) {
    const r = dest ? await flushQueue(dest) : null;
    await refresh();
    // 送中繼站時可能因為憑證失效被清掉,重新讀一次狀態
    setRelay(getRelayState());

    if (r && r.sent > 0) setNotice(sentNotice(r));
    else if (savedJustNow) setNotice("已存進手機。有網路時打開這個 App 就會自動送出。");
    else if (!r) setNotice("現在哪裡都送不到,照片會留在手機,有網路時再送。");
    else if (!r.error) setNotice("沒有待送的單據。");
    if (r?.error) setError(r.error);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    const form = e.currentTarget as HTMLFormElement;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // 一律先進佇列:送不出去照片也不會掉(ADR-0009)
      await enqueue({ blob: file, mimeType: file.type || "image/jpeg", note: note.trim() });
      setFile(null);
      setNote("");
      // 清掉 file input 的選檔狀態
      form.reset();
      // 存完立刻試著送:拍照的當下 App 一定開著,這是送出去最好的時機
      await flushAndReport(await probe(), true);
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
      await flushAndReport(await probe(), false);
    } catch (err) {
      setError((err as Error)?.message ?? "送出失敗");
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

  const canSend = reach !== null && reach !== "none";

  return (
    <>
      <p
        className={
          reach === null
            ? "chip"
            : reach === "none"
              ? "chip chip-warn"
              : reach.kind === "server"
                ? "chip chip-ok"
                : "chip chip-info"
        }
      >
        {reach === null
          ? "確認連線中…"
          : reach === "none"
            ? "連不到 —— 照片會先存在手機"
            : reach.kind === "server"
              ? "連得到辦公室電腦,存檔後直接送出"
              : "辦公室電腦沒開 —— 照片會送到雲端中繼站"}
      </p>

      {reach === "none" && relay.status === "unknown" ? (
        <p className="small muted">
          還沒領到雲端中繼站的憑證。在連得到辦公室電腦的地方打開一次這個 App,
          之後電腦沒開時照片也能先送到雲端。
        </p>
      ) : null}

      {notice ? <p className="ok-text">{notice}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <form onSubmit={onSave} className="card">
        <h2>拍一張收據</h2>
        <p className="small muted">
          不用填金額日期 —— 由 AI 辨識,回辦公室再核對。
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
            maxLength={RELAY_NOTE_MAX_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例:客戶 A 晚餐"
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !file}>
          {busy ? "處理中…" : canSend ? "存檔並送出" : "存進手機"}
        </button>
      </form>

      <div className="row-between">
        <h2>待送出({items.length})</h2>
        {items.length > 0 ? (
          <button type="button" className="btn btn-sm" onClick={onFlush} disabled={busy || !canSend}>
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
