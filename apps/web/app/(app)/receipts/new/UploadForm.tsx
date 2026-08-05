"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  formatAmount,
  isEInvoiceLeftQr,
  parseEInvoiceQr,
  type EInvoiceQr,
} from "@expense-receipts/core";
import type { QrDecodeResponse } from "./qr-worker";
import { MANUAL_DOC_TYPES } from "@/lib/labels";
import { DOC_TYPE_LABELS } from "@/lib/labels";
import { createReceipt, type ActionState } from "../actions";

type Category = { id: string; name: string };

type Decoded =
  | { mode: "qr"; invoice: EInvoiceQr }
  /** QR 沒解出來:讓使用者選 AI 辨識或手動輸入 */
  | { mode: "fallback"; note: string }
  | null;

/** QR 解不到時的兩條路;預設走 AI(Phase 2 的重點就是省下手打) */
type Fallback = "ai" | "manual";


/**
 * 解碼時把長邊縮到這個尺寸。
 *
 * 為什麼一定要縮:手機照片是 4000×3000 ≈ 1200 萬像素,jsQR 是**同步**運算,
 * 直接掃原圖會鎖死主執行緒好幾十秒 —— 畫面看起來就是完全凍住。
 * QR 偵測需要的是每個模組 2~3 像素,不是整張高解析度。
 *
 * 兩段式:先用 1600(快),沒找到再用 2600 試一次(電子發票的 QR 在整張照片裡
 * 佔比很小,縮太多可能讀不到)。
 */
const DECODE_EDGES = [1600, 2600] as const;

/** 解碼逾時上限:超過就放棄走 AI 辨識,不讓使用者卡在灰掉的按鈕前 */
const DECODE_TIMEOUT_MS = 8000;

/** 把 bitmap 縮到指定長邊,取出 RGBA 像素(原生實作,主執行緒跑很快) */
function extractPixels(
  bitmap: ImageBitmap,
  maxEdge: number,
): { buffer: ArrayBuffer; width: number; height: number } | null {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  return { buffer: data.buffer as ArrayBuffer, width, height };
}

/** 把一份像素丟給 worker 解碼 */
function decodeInWorker(
  worker: Worker,
  payload: { buffer: ArrayBuffer; width: number; height: number },
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<QrDecodeResponse>) => {
      cleanup();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve(event.data.text);
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || "worker 錯誤"));
    };
    function cleanup() {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    }
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    // transfer:像素陣列直接移交,不複製
    worker.postMessage(payload, [payload.buffer]);
  });
}

/**
 * 在瀏覽器解碼影像上的 QR。目前一次只取找到的第一顆條碼:
 * 若是電子發票左條碼(含所有帳務關鍵欄位)即採用;右條碼(接續品項)暫不處理。
 *
 * 先掃縮小版(快),沒找到再掃大一級 —— 電子發票的 QR 在整張照片裡佔比很小,
 * 縮太多可能讀不到。因為跑在 worker 裡,多掃一輪不會讓畫面卡住。
 */
async function decodeQr(worker: Worker, file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const edge of DECODE_EDGES) {
      const payload = extractPixels(bitmap, edge);
      if (!payload) return null;
      const found = await decodeInWorker(worker, payload);
      if (found) return found;
      // 原圖比這一級還小,再放大掃一次沒有意義
      if (Math.max(bitmap.width, bitmap.height) <= edge) break;
    }
    return null;
  } finally {
    bitmap.close?.();
  }
}

/** 逾時就當作「沒有條碼」,交給 AI 辨識 —— 卡住不動比辨識失敗更難處理 */
async function decodeQrWithTimeout(worker: Worker, file: File): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DECODE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([decodeQr(worker, file), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function UploadForm({ categories }: { categories: Category[] }) {
  const [state, formAction, pending] = useActionState(createReceipt, {} as ActionState);
  const [decoded, setDecoded] = useState<Decoded>(null);
  const [decoding, setDecoding] = useState(false);
  const [fallback, setFallback] = useState<Fallback>("ai");
  const fileRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  // worker 延後建立(選檔時才需要),離開頁面時收掉
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  /** 建不出 worker(舊瀏覽器、被政策擋掉)時回 null,改直接走 AI 辨識 */
  function getWorker(): Worker | null {
    if (!workerRef.current) {
      try {
        workerRef.current = new Worker(new URL("./qr-worker.ts", import.meta.url));
      } catch {
        return null;
      }
    }
    return workerRef.current;
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setDecoded(null);
      return;
    }
    setDecoding(true);
    // 先讓表單可用(預設 AI 辨識),解碼是「有找到才升級成掃碼模式」的加分項。
    // 這樣即使解碼慢或失敗,使用者也不會卡在灰掉的按鈕前。
    setDecoded({ mode: "fallback", note: "正在檢查有沒有電子發票條碼…" });
    const worker = getWorker();
    if (!worker) {
      // 沒有 worker 就不在主執行緒硬掃(那會凍住畫面),直接交給 AI 辨識
      setDecoded({ mode: "fallback", note: "這個瀏覽器無法在本機解條碼。" });
      setDecoding(false);
      return;
    }
    try {
      const raw = await decodeQrWithTimeout(worker, file);
      if (raw && isEInvoiceLeftQr(raw)) {
        const invoice = parseEInvoiceQr(raw);
        setDecoded(invoice ? { mode: "qr", invoice } : { mode: "fallback", note: "條碼解析失敗。" });
      } else {
        setDecoded({
          mode: "fallback",
          note: raw ? "未偵測到電子發票條碼。" : "影像中沒有可讀取的條碼。",
        });
      }
    } catch {
      setDecoded({ mode: "fallback", note: "無法在瀏覽器讀取這張影像。" });
    } finally {
      setDecoding(false);
    }
  }

  return (
    <form action={formAction} className="stack">
      <div className="card">
        <div className="field">
          <label htmlFor="image">單據影像</label>
          {/*
            刻意不加 capture="environment":那會強制直接開相機,iOS 就不顯示
            「照片圖庫」。不加的話系統會跳選單,拍照與選相簿都在裡面 ——
            出差時常是先把收據拍在相機裡,回來再一批一批選檔上傳。
          */}
          <input
            ref={fileRef}
            id="image"
            className="input"
            type="file"
            name="image"
            accept="image/*"
            required
            onChange={onFileChange}
          />
          <span className="field-hint">可以直接拍照,也可以從相簿或檔案選既有照片。</span>
        </div>

        {decoding ? (
          <p className="chip chip-info">
            <span className="spinner" aria-hidden="true" /> 檢查有沒有電子發票條碼…
          </p>
        ) : null}
      </div>

      {decoded === null ? null : decoded.mode === "fallback" ? (
        <>
          <div className="card">
            <p className="small muted">{decoded.note}</p>
            <div className="choice">
              {(["ai", "manual"] as const).map((m) => (
                <label key={m}>
                  <input
                    type="radio"
                    name="fallbackMode"
                    value={m}
                    checked={fallback === m}
                    onChange={() => setFallback(m)}
                  />
                  {m === "ai" ? "交給 AI 辨識" : "自己手動輸入"}
                </label>
              ))}
            </div>
          </div>

          {fallback === "ai" ? (
            <section className="card">
              <input type="hidden" name="source" value="ai" />
              <div className="row-between">
                <h2>AI 辨識</h2>
                <span className="chip chip-warn">結果需人工確認</span>
              </div>
              <p className="small muted">
                上傳後由背景程序辨識日期、店家、金額、稅額與分類。完成後這張單據會停在「待確認」,
                你核對金額再入帳。通常幾秒內完成。
              </p>
              <div className="field">
                <label htmlFor="ai-category">分類</label>
                <select id="ai-category" className="select" name="categoryId" defaultValue="">
                  <option value="">由 AI 建議</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ai-note">備註</label>
                <input id="ai-note" className="input" type="text" name="note" />
                <span className="field-hint">選填。填了就不會被 AI 摘要覆蓋。</span>
              </div>
            </section>
          ) : (
            <section className="card">
              <input type="hidden" name="source" value="manual" />
              <h2>手動輸入</h2>

              <div className="grid-2">
                <div className="field">
                  <label htmlFor="m-docType">單據類型</label>
                  <select id="m-docType" className="select" name="docType" defaultValue="receipt">
                    {MANUAL_DOC_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {DOC_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="m-date">日期</label>
                  <input id="m-date" className="input" type="date" name="invoiceDate" required />
                </div>
              </div>

              <div className="field">
                <label htmlFor="m-seller">賣方名稱</label>
                <input id="m-seller" className="input" type="text" name="sellerName" />
              </div>

              <div className="grid-2">
                <div className="field">
                  <label htmlFor="m-amount">含稅金額</label>
                  <input
                    id="m-amount"
                    className="input"
                    type="text"
                    name="amount"
                    inputMode="decimal"
                    required
                    placeholder="1050"
                  />
                </div>
                <div className="field">
                  <label htmlFor="m-tax">稅額</label>
                  <input id="m-tax" className="input" type="text" name="taxAmount" inputMode="decimal" />
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label htmlFor="m-currency">幣別</label>
                  <input id="m-currency" className="input" type="text" name="currency" defaultValue="TWD" />
                </div>
                <div className="field">
                  <label htmlFor="m-category">分類</label>
                  <select id="m-category" className="select" name="categoryId" defaultValue="">
                    <option value="">未分類</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <details>
                <summary className="small">統編與發票號碼(選填)</summary>
                <div className="stack stack-inset">
                  <div className="field">
                    <label htmlFor="m-sellerTax">賣方統編</label>
                    <input id="m-sellerTax" className="input" type="text" name="sellerTaxId" inputMode="numeric" />
                  </div>
                  <div className="field">
                    <label htmlFor="m-buyerTax">買方統編</label>
                    <input id="m-buyerTax" className="input" type="text" name="buyerTaxId" inputMode="numeric" />
                  </div>
                  <div className="field">
                    <label htmlFor="m-invoiceNumber">發票號碼</label>
                    <input id="m-invoiceNumber" className="input" type="text" name="invoiceNumber" />
                  </div>
                </div>
              </details>

              <div className="field">
                <label htmlFor="m-note">備註</label>
                <input id="m-note" className="input" type="text" name="note" />
              </div>
            </section>
          )}
        </>
      ) : (
        <QrFieldset invoice={decoded.invoice} categories={categories} />
      )}

      {state.error ? <p className="error-text">{state.error}</p> : null}

      {/*
        解碼期間仍鎖住送出:如果這張是電子發票,搶先送出會白花一次 AI 辨識、
        還得人工確認。縮圖 + worker 後解碼通常不到 1 秒,且有 8 秒逾時上限兜底。
      */}
      <div className="actions-bar">
        <div className="actions-bar-inner">
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={pending || decoding || decoded === null}
          >
            {pending ? (
              <>
                <span className="spinner" aria-hidden="true" /> 儲存中…
              </>
            ) : decoding ? (
              "檢查條碼中…"
            ) : decoded === null ? (
              "先選一張單據影像"
            ) : decoded.mode === "fallback" && fallback === "ai" ? (
              "上傳並辨識"
            ) : (
              "儲存單據"
            )}
          </button>
        </div>
      </div>
    </form>
  );
}

/** 掃到電子發票條碼:欄位已是財政部規格的一手資料,只給人確認一眼就直接入帳 */
function QrFieldset({ invoice, categories }: { invoice: EInvoiceQr; categories: Category[] }) {
  const taxAmount = invoice.totalAmount - invoice.salesAmount;

  return (
    <section className="card">
      <input type="hidden" name="source" value="qr" />
      <input type="hidden" name="invoiceNumber" value={invoice.invoiceNumber} />
      <input type="hidden" name="invoiceDate" value={invoice.invoiceDate} />
      <input type="hidden" name="sellerTaxId" value={invoice.sellerTaxId} />
      <input type="hidden" name="buyerTaxId" value={invoice.buyerTaxId ?? ""} />
      <input type="hidden" name="amount" value={String(invoice.totalAmount)} />
      <input type="hidden" name="taxAmount" value={String(taxAmount)} />
      <input type="hidden" name="rawData" value={JSON.stringify(invoice)} />

      <div className="row-between">
        <h2>電子發票</h2>
        <span className="chip chip-ok">掃碼,將直接入帳</span>
      </div>
      <p className="small muted">條碼是財政部規格的一手資料,不經過 AI,核對一眼即可。</p>

      <div className="table-wrap">
        <table className="table">
          <tbody>
            <tr>
              <th scope="row">發票號碼</th>
              <td className="tnum">{invoice.invoiceNumber}</td>
            </tr>
            <tr>
              <th scope="row">日期</th>
              <td className="tnum">{invoice.invoiceDate}</td>
            </tr>
            <tr>
              <th scope="row">賣方統編</th>
              <td className="tnum">{invoice.sellerTaxId}</td>
            </tr>
            <tr>
              <th scope="row">買方統編</th>
              <td className="tnum">{invoice.buyerTaxId ?? "(個人,未打統編)"}</td>
            </tr>
            <tr>
              <th scope="row">含稅總額</th>
              <td className="num">{formatAmount(String(invoice.totalAmount), "TWD")}</td>
            </tr>
            <tr>
              <th scope="row">稅額</th>
              <td className="num">{formatAmount(String(taxAmount), "TWD")}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="field">
        <label htmlFor="qr-category">分類</label>
        <select id="qr-category" className="select" name="categoryId" defaultValue="">
          <option value="">未分類(可稍後補)</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
