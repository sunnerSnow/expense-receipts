"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestExport, type ExportActionState } from "./actions";

/**
 * 匯出按鈕。
 *
 * 刻意要求輸入確認字串:匯出會把單據推進 exported 終態(之後不可修改、不可刪除),
 * 是這個系統唯一不可逆的操作,不該只隔一次點擊。
 */
export function ExportForm({ month, count }: { month: string; count: number }) {
  const [state, action, pending] = useActionState(requestExport, {} as ExportActionState);
  const router = useRouter();

  // 匯出在背景跑,完成後才會出現在紀錄表 —— 派工成功後輪詢幾次把它撈出來
  useEffect(() => {
    if (!state.queued) return;
    const timer = setInterval(() => router.refresh(), 2000);
    const stop = setTimeout(() => clearInterval(timer), 30000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [state.queued, router]);

  // 零筆時不再重複一次空狀態:頁面上方已經說明「要先確認入帳」
  if (count === 0) return null;

  return (
    <form action={action} className="card">
      <input type="hidden" name="period" value={month} />
      <h2>產生匯出檔</h2>
      <p className="small">
        將匯出 <strong className="tnum">{month}</strong> 的 <strong>{count}</strong> 筆已確認單據,
        並把它們標記為<strong>已匯出(不可再修改或刪除)</strong>。
      </p>
      {state.error ? <p className="error-text">{state.error}</p> : null}
      {state.queued ? (
        <p className="ok-text">
          已開始產生 {state.queued} 的匯出檔(背景執行,完成後會出現在下方紀錄;需要 worker 在跑)。
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? (
          <>
            <span className="spinner" aria-hidden="true" /> 派送中…
          </>
        ) : (
          `產生 ${month} 匯出檔`
        )}
      </button>
    </form>
  );
}
