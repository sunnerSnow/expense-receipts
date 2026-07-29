"use client";

import { useActionState, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  isEInvoiceLeftQr,
  parseEInvoiceQr,
  type EInvoiceQr,
} from "@expense-receipts/core";
import { MANUAL_DOC_TYPES } from "@/lib/labels";
import { DOC_TYPE_LABELS } from "@/lib/labels";
import { createReceipt, type ActionState } from "../actions";

type Category = { id: string; name: string };

type Decoded =
  | { mode: "qr"; invoice: EInvoiceQr }
  | { mode: "manual"; note: string }
  | null;

const inputStyle = { padding: "0.5rem", fontSize: "1rem", width: "100%" } as const;
const rowStyle = { display: "grid", gap: "0.25rem", marginBottom: "0.75rem" } as const;

/**
 * 在瀏覽器解碼影像上的 QR。目前一次只取 jsQR 找到的第一顆條碼:
 * 若是電子發票左條碼(含所有帳務關鍵欄位)即採用;右條碼(接續品項)暫不處理。
 */
async function decodeQr(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
  return code?.data ?? null;
}

export function UploadForm({ categories }: { categories: Category[] }) {
  const [state, formAction, pending] = useActionState(createReceipt, {} as ActionState);
  const [decoded, setDecoded] = useState<Decoded>(null);
  const [decoding, setDecoding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setDecoded(null);
      return;
    }
    setDecoding(true);
    try {
      const raw = await decodeQr(file);
      if (raw && isEInvoiceLeftQr(raw)) {
        const invoice = parseEInvoiceQr(raw);
        setDecoded(invoice ? { mode: "qr", invoice } : { mode: "manual", note: "條碼解析失敗,請手動輸入。" });
      } else {
        setDecoded({
          mode: "manual",
          note: raw ? "未偵測到電子發票條碼,請手動輸入。" : "影像中沒有可讀取的條碼,請手動輸入。",
        });
      }
    } catch {
      setDecoded({ mode: "manual", note: "無法讀取影像,請手動輸入。" });
    } finally {
      setDecoding(false);
    }
  }

  const qr = decoded?.mode === "qr" ? decoded.invoice : null;
  const taxAmount = qr ? qr.totalAmount - qr.salesAmount : undefined;

  return (
    <form action={formAction}>
      <div style={rowStyle}>
        <label htmlFor="image">單據影像</label>
        <input
          ref={fileRef}
          id="image"
          type="file"
          name="image"
          accept="image/*"
          capture="environment"
          required
          onChange={onFileChange}
        />
        {decoding ? <small>解析條碼中…</small> : null}
      </div>

      {decoded === null ? null : decoded.mode === "qr" && qr ? (
        <fieldset style={{ marginBottom: "0.75rem" }}>
          <legend>✅ 電子發票(掃碼,將直接入帳)</legend>
          <input type="hidden" name="source" value="qr" />
          <input type="hidden" name="invoiceNumber" value={qr.invoiceNumber} />
          <input type="hidden" name="invoiceDate" value={qr.invoiceDate} />
          <input type="hidden" name="sellerTaxId" value={qr.sellerTaxId} />
          <input type="hidden" name="buyerTaxId" value={qr.buyerTaxId ?? ""} />
          <input type="hidden" name="amount" value={String(qr.totalAmount)} />
          <input type="hidden" name="taxAmount" value={String(taxAmount ?? "")} />
          <input type="hidden" name="rawData" value={JSON.stringify(qr)} />
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 1rem", margin: 0 }}>
            <dt>發票號碼</dt>
            <dd style={{ margin: 0 }}>{qr.invoiceNumber}</dd>
            <dt>日期</dt>
            <dd style={{ margin: 0 }}>{qr.invoiceDate}</dd>
            <dt>賣方統編</dt>
            <dd style={{ margin: 0 }}>{qr.sellerTaxId}</dd>
            <dt>買方統編</dt>
            <dd style={{ margin: 0 }}>{qr.buyerTaxId ?? "(個人,未打統編)"}</dd>
            <dt>含稅總額</dt>
            <dd style={{ margin: 0 }}>NT${qr.totalAmount.toLocaleString()}</dd>
            <dt>稅額</dt>
            <dd style={{ margin: 0 }}>NT${(taxAmount ?? 0).toLocaleString()}</dd>
          </dl>
          <div style={{ ...rowStyle, marginTop: "0.75rem" }}>
            <label htmlFor="qr-category">分類(可稍後補)</label>
            <select id="qr-category" name="categoryId" style={inputStyle} defaultValue="">
              <option value="">未分類</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      ) : (
        <fieldset style={{ marginBottom: "0.75rem" }}>
          <legend>手動輸入</legend>
          {decoded.mode === "manual" ? <p style={{ marginTop: 0, color: "#b8860b" }}>{decoded.note}</p> : null}
          <input type="hidden" name="source" value="manual" />

          <div style={rowStyle}>
            <label htmlFor="m-docType">單據類型</label>
            <select id="m-docType" name="docType" style={inputStyle} defaultValue="receipt">
              {MANUAL_DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div style={rowStyle}>
            <label htmlFor="m-date">日期</label>
            <input id="m-date" type="date" name="invoiceDate" required style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="m-seller">賣方名稱</label>
            <input id="m-seller" type="text" name="sellerName" style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="m-sellerTax">賣方統編(選填)</label>
            <input id="m-sellerTax" type="text" name="sellerTaxId" inputMode="numeric" style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="m-buyerTax">買方統編(選填,打公司統編才可扣抵)</label>
            <input id="m-buyerTax" type="text" name="buyerTaxId" inputMode="numeric" style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="m-invoiceNumber">發票號碼(選填)</label>
            <input id="m-invoiceNumber" type="text" name="invoiceNumber" style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="m-amount">含稅金額</label>
            <input id="m-amount" type="text" name="amount" inputMode="decimal" required placeholder="1050" style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="m-tax">稅額(選填)</label>
            <input id="m-tax" type="text" name="taxAmount" inputMode="decimal" style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="m-currency">幣別</label>
            <input id="m-currency" type="text" name="currency" defaultValue="TWD" style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="m-category">分類</label>
            <select id="m-category" name="categoryId" style={inputStyle} defaultValue="">
              <option value="">未分類</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div style={rowStyle}>
            <label htmlFor="m-note">備註(選填)</label>
            <input id="m-note" type="text" name="note" style={inputStyle} />
          </div>
        </fieldset>
      )}

      {state.error ? <p style={{ color: "#c0392b" }}>{state.error}</p> : null}

      <button type="submit" disabled={pending || decoded === null} style={{ padding: "0.6rem 1.2rem", fontSize: "1rem" }}>
        {pending ? "儲存中…" : "儲存單據"}
      </button>
    </form>
  );
}
