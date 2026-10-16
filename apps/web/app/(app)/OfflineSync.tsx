"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  countPending,
  flushQueue,
  isOfflineQueueSupported,
  isServerReachable,
  pickDestination,
  refreshRelayCredential,
  type Destination,
} from "@/lib/offline-queue";

/**
 * 掛在每一頁:註冊 service worker、連得到本機時更新中繼站憑證,並自動送出離線佇列。
 *
 * 為什麼是「開 App 就送」而不是 Background Sync:**iOS Safari 不支援
 * Background Sync**,而使用者主力是 iPhone。這個做法在所有瀏覽器都成立。
 *
 * 憑證在這裡更新(而不是只在離線頁):出差前隨便打開 App 的任何一頁,
 * 手機就領好中繼站憑證了,不必特地記得去開離線頁(ADR-0009)。
 */
export function OfflineSync() {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState<{ count: number; to: Destination["kind"] } | null>(null);

  const sync = useCallback(async () => {
    if (!isOfflineQueueSupported()) return;

    // 探測伺服器而不是看 navigator.onLine:手機有 4G 但電腦沒開時 onLine 是 true
    const reachable = await isServerReachable();
    if (reachable) await refreshRelayCredential();

    let count = 0;
    try {
      count = await countPending();
    } catch {
      return; // 私密瀏覽等情況讀不到,靜默略過
    }
    setPending(count);
    if (count === 0) return;

    const destination = await pickDestination(reachable);
    if (!destination) return;

    setSending(true);
    try {
      const r = await flushQueue(destination);
      setPending(await countPending());
      if (r.sent > 0 && r.destination) {
        setJustSent({ count: r.sent, to: r.destination });
        // 讓列表頁看得到剛補送進來的「辨識中」單據
        if (r.destination === "server") router.refresh();
      }
    } catch {
      // 失敗不吵使用者:離線頁有完整的錯誤與重試介面
    } finally {
      setSending(false);
    }
  }, [router]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 註冊失敗只是少了離線開啟的能力,佇列本身照常運作
      });
    }
    void sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [sync]);

  if (sending) {
    return (
      <p className="banner">
        <span className="spinner" aria-hidden="true" /> 正在送出 {pending} 筆離線單據…
      </p>
    );
  }

  if (justSent) {
    return justSent.to === "server" ? (
      <p className="banner banner-ok">
        已補送 {justSent.count} 筆離線單據,AI 辨識中 —— 完成後在列表的「待處理」區塊核對。
      </p>
    ) : (
      <p className="banner banner-ok">
        已把 {justSent.count} 筆離線單據送到雲端中繼站,辦公室電腦開機後會自動進來。
      </p>
    );
  }

  if (pending > 0) {
    return (
      <p className="banner banner-warn">
        有 {pending} 筆離線單據還沒送出。
        <Link href="/receipts/new/offline">去看看</Link>
      </p>
    );
  }

  return null;
}
