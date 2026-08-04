"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type {
  Deductibility,
  ReceiptDocType,
  ReceiptSource,
  ReceiptStatus,
  RecognitionStatus,
} from "@expense-receipts/core";
import {
  DEDUCTIBILITY_LABELS,
  DOC_TYPE_LABELS,
  MANUAL_DOC_TYPES,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";
import {
  confirmReceipt,
  deleteReceipt,
  retryRecognition,
  updateReceipt,
  type ActionState,
} from "../actions";

type Category = { id: string; name: string };

export type ReceiptView = {
  id: string;
  status: ReceiptStatus;
  docType: ReceiptDocType;
  source: ReceiptSource;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  sellerName: string | null;
  sellerTaxId: string | null;
  buyerTaxId: string | null;
  currency: string;
  amount: string;
  taxAmount: string | null;
  deductibility: Deductibility | null;
  categoryId: string | null;
  note: string | null;
  hasImage: boolean;
  recognitionStatus: RecognitionStatus;
  recognitionError: string | null;
  recognitionWarnings: string[] | null;
};

const inputStyle = { padding: "0.5rem", fontSize: "1rem", width: "100%" } as const;
const rowStyle = { display: "grid", gap: "0.25rem", marginBottom: "0.75rem" } as const;

// 掃碼進來的電子發票也允許在明細頁改分類/備註,但類型固定為電子發票
const docTypeOptions = (current: ReceiptDocType): ReceiptDocType[] =>
  current === "einvoice" ? ["einvoice"] : MANUAL_DOC_TYPES;

export function ReceiptDetail({ receipt, categories }: { receipt: ReceiptView; categories: Category[] }) {
  const [editState, editAction, editing] = useActionState(updateReceipt, {} as ActionState);
  const [confirmState, confirmAction, confirming] = useActionState(confirmReceipt, {} as ActionState);
  const [deleteState, deleteAction, deleting] = useActionState(deleteReceipt, {} as ActionState);
  const [retryState, retryAction, retrying] = useActionState(retryRecognition, {} as ActionState);
  const router = useRouter();

  const recognizing = receipt.recognitionStatus === "queued";
  const readOnly = receipt.status === "exported" || recognizing;
  const warnings = receipt.recognitionWarnings ?? [];

  // 辨識中的單據自己輪詢:worker 寫回資料庫不會通知瀏覽器,不然使用者得手動重整
  useEffect(() => {
    if (!recognizing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [recognizing, router]);

  return (
    <>
      <p>
        <a href="/receipts">← 回列表</a>
      </p>
      <h1>單據明細</h1>
      <p style={{ color: "#666" }}>
        來源:{SOURCE_LABELS[receipt.source]}　狀態:{STATUS_LABELS[receipt.status]}
        {receipt.deductibility ? `　${DEDUCTIBILITY_LABELS[receipt.deductibility]}` : ""}
      </p>

      {recognizing ? (
        <p style={{ padding: "0.75rem", background: "#eef5ff", border: "1px solid #b9d3f5", borderRadius: 8 }}>
          🤖 AI 辨識中…(自動更新,不用重整)
        </p>
      ) : null}

      {receipt.recognitionStatus === "failed" && receipt.recognitionError ? (
        <div style={{ padding: "0.75rem", background: "#fdecea", border: "1px solid #f5c2bd", borderRadius: 8 }}>
          <strong>辨識失敗:</strong>
          {receipt.recognitionError}
          <p style={{ margin: "0.5rem 0 0", color: "#666" }}>可以直接在下面手動填寫,或重新辨識一次。</p>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div style={{ padding: "0.75rem", background: "#fff8e1", border: "1px solid #ecd08a", borderRadius: 8 }}>
          <strong>AI 辨識結果請核對這幾點:</strong>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {receipt.hasImage ? (
        // 限制高度:直式收據照片(3024×4032)在手機上會佔掉大半個螢幕,
        // 把要核對的欄位與按鈕推到很下面。點圖可開原尺寸。
        <p style={{ margin: "0 0 1rem" }}>
          <a href={`/receipts/${receipt.id}/image`} target="_blank" rel="noreferrer">
            <img
              src={`/receipts/${receipt.id}/image`}
              alt="單據影像(點擊看原尺寸)"
              style={{
                maxWidth: "100%",
                maxHeight: "40vh",
                objectFit: "contain",
                border: "1px solid #ddd",
                borderRadius: 8,
                display: "block",
              }}
            />
          </a>
          <small style={{ color: "#666" }}>點圖可開原尺寸對照</small>
        </p>
      ) : null}

      {readOnly ? (
        <p style={{ color: "#b8860b" }}>
          {recognizing ? "辨識完成後才能編輯欄位(避免 AI 回填時蓋掉你的輸入)。" : "此單據已匯出,鎖定不可修改。"}
        </p>
      ) : (
        <form action={editAction}>
          <input type="hidden" name="id" value={receipt.id} />

          <div style={rowStyle}>
            <label htmlFor="docType">單據類型</label>
            <select id="docType" name="docType" defaultValue={receipt.docType} style={inputStyle} disabled={receipt.docType === "einvoice"}>
              {docTypeOptions(receipt.docType).map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {receipt.docType === "einvoice" ? <input type="hidden" name="docType" value="einvoice" /> : null}
          </div>

          <div style={rowStyle}>
            <label htmlFor="invoiceDate">日期</label>
            <input id="invoiceDate" type="date" name="invoiceDate" defaultValue={receipt.invoiceDate ?? ""} required style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="sellerName">賣方名稱</label>
            <input id="sellerName" type="text" name="sellerName" defaultValue={receipt.sellerName ?? ""} style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="sellerTaxId">賣方統編</label>
            <input id="sellerTaxId" type="text" name="sellerTaxId" defaultValue={receipt.sellerTaxId ?? ""} inputMode="numeric" style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="buyerTaxId">買方統編(打公司統編才可扣抵)</label>
            <input id="buyerTaxId" type="text" name="buyerTaxId" defaultValue={receipt.buyerTaxId ?? ""} inputMode="numeric" style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="invoiceNumber">發票號碼</label>
            <input id="invoiceNumber" type="text" name="invoiceNumber" defaultValue={receipt.invoiceNumber ?? ""} style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="amount">含稅金額({receipt.currency})</label>
            <input id="amount" type="text" name="amount" defaultValue={receipt.amount} inputMode="decimal" required style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="taxAmount">稅額</label>
            <input id="taxAmount" type="text" name="taxAmount" defaultValue={receipt.taxAmount ?? ""} inputMode="decimal" style={inputStyle} />
          </div>
          <div style={rowStyle}>
            <label htmlFor="categoryId">分類</label>
            <select id="categoryId" name="categoryId" defaultValue={receipt.categoryId ?? ""} style={inputStyle}>
              <option value="">未分類</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div style={rowStyle}>
            <label htmlFor="note">備註</label>
            <input id="note" type="text" name="note" defaultValue={receipt.note ?? ""} style={inputStyle} />
          </div>

          {editState.error ? <p style={{ color: "#c0392b" }}>{editState.error}</p> : null}
          <button type="submit" disabled={editing} style={{ padding: "0.6rem 1.2rem", fontSize: "1rem" }}>
            {editing ? "儲存中…" : "儲存變更"}
          </button>
        </form>
      )}

      <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
        {receipt.source === "ai" && receipt.status === "pending_review" && !recognizing ? (
          <form action={retryAction}>
            <input type="hidden" name="id" value={receipt.id} />
            <button type="submit" disabled={retrying} style={{ padding: "0.5rem 1rem" }}>
              {retrying ? "派送中…" : "重新辨識"}
            </button>
            {retryState.error ? <span style={{ color: "#c0392b", marginLeft: "0.5rem" }}>{retryState.error}</span> : null}
          </form>
        ) : null}

        {receipt.status === "pending_review" && !recognizing ? (
          <form action={confirmAction}>
            <input type="hidden" name="id" value={receipt.id} />
            <button type="submit" disabled={confirming} style={{ padding: "0.5rem 1rem" }}>
              {confirming ? "確認中…" : "確認入帳"}
            </button>
            {confirmState.error ? <span style={{ color: "#c0392b", marginLeft: "0.5rem" }}>{confirmState.error}</span> : null}
          </form>
        ) : null}

        {!readOnly ? (
          <form action={deleteAction}>
            <input type="hidden" name="id" value={receipt.id} />
            <button type="submit" disabled={deleting} style={{ padding: "0.5rem 1rem", color: "#c0392b" }}>
              {deleting ? "刪除中…" : "刪除"}
            </button>
            {deleteState.error ? <span style={{ color: "#c0392b", marginLeft: "0.5rem" }}>{deleteState.error}</span> : null}
          </form>
        ) : null}
      </div>
    </>
  );
}
