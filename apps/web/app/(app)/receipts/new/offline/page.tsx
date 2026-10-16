import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { OfflineCapture } from "./OfflineCapture";

/**
 * 離線拍收據。
 *
 * 這頁刻意**不從伺服器取任何資料**(沒有分類清單、沒有單據列表)——
 * 它必須在完全沒網路時也能打開,而 service worker 只快取得了靜態內容。
 * 分類交給 AI 建議,回辦公室核對時再改。
 */
export default async function OfflineCapturePage() {
  await requireUser();

  return (
    <>
      <h1>離線拍收據</h1>
      {env.RELAY_URL ? (
        <p className="muted small">
          人在外面、電腦沒開的時候用這頁:有網路就先送到雲端中繼站,辦公室電腦
          開機後自動進來辨識;完全沒網路(例如飛機上)就先存在手機,有網路時
          打開這個 App 再送。
        </p>
      ) : (
        <p className="muted small">
          人在國外、電腦沒開的時候用這頁:照片先存在手機裡,回到有網路的地方
          打開這個 App 就會自動補送、進 AI 辨識。
        </p>
      )}

      <OfflineCapture />

      <p className="small muted">
        有網路而且電腦開著的時候,用 <Link href="/receipts/new">一般上傳</Link>{" "}
        比較快(會當場掃電子發票條碼)。
      </p>
    </>
  );
}
