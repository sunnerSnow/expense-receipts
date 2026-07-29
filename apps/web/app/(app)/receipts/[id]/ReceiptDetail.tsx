"use client";

import { useActionState } from "react";
import type {
  Deductibility,
  ReceiptDocType,
  ReceiptSource,
  ReceiptStatus,
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

  const readOnly = receipt.status === "exported";

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

      {receipt.hasImage ? (
        <img
          src={`/receipts/${receipt.id}/image`}
          alt="單據影像"
          style={{ maxWidth: "100%", border: "1px solid #ddd", borderRadius: 8, marginBottom: "1rem" }}
        />
      ) : null}

      {readOnly ? (
        <p style={{ color: "#b8860b" }}>此單據已匯出,鎖定不可修改。</p>
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
        {receipt.status === "pending_review" ? (
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
