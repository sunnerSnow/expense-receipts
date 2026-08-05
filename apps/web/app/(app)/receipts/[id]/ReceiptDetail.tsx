"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  Deductibility,
  ReceiptDocType,
  ReceiptSource,
  ReceiptStatus,
  RecognitionStatus,
} from "@expense-receipts/core";
import {
  DEDUCTIBILITY_CHIP,
  DEDUCTIBILITY_LABELS,
  DOC_TYPE_LABELS,
  MANUAL_DOC_TYPES,
  SOURCE_LABELS,
  STATUS_CHIP,
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
      <div className="stack-sm">
        <p className="small">
          <Link href="/receipts">← 回列表</Link>
        </p>
        <div className="row-between">
          <h1>單據明細</h1>
          <span className={STATUS_CHIP[receipt.status]}>{STATUS_LABELS[receipt.status]}</span>
        </div>
        <div className="row small">
          <span className="chip">{SOURCE_LABELS[receipt.source]}</span>
          <span className="chip">{DOC_TYPE_LABELS[receipt.docType]}</span>
          {receipt.deductibility ? (
            <span className={DEDUCTIBILITY_CHIP[receipt.deductibility]}>
              {DEDUCTIBILITY_LABELS[receipt.deductibility]}
            </span>
          ) : null}
        </div>
      </div>

      {recognizing ? (
        <p className="banner banner-info">
          <span>
            <span className="spinner" aria-hidden="true" /> AI 辨識中…(自動更新,不用重整)
          </span>
        </p>
      ) : null}

      {receipt.recognitionStatus === "failed" && receipt.recognitionError ? (
        <div className="banner banner-danger">
          <strong>辨識失敗</strong>
          <span>{receipt.recognitionError}</span>
          <span className="small">可以直接在下面手動填寫,或重新辨識一次。</span>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="banner banner-warn">
          <strong>請核對這幾點</strong>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {receipt.hasImage ? (
        // 限制高度:直式收據照片(3024×4032)會佔掉大半個手機螢幕,
        // 把要核對的欄位推到螢幕外。點圖開原尺寸對照。
        <div className="card">
          <a href={`/receipts/${receipt.id}/image`} target="_blank" rel="noreferrer">
            <img className="receipt-image" src={`/receipts/${receipt.id}/image`} alt="單據影像(點擊看原尺寸)" />
          </a>
          <span className="field-hint">點圖可開原尺寸對照</span>
        </div>
      ) : null}

      {readOnly ? (
        <p className="banner">
          {recognizing
            ? "辨識完成後才能編輯欄位(避免 AI 回填時蓋掉你的輸入)。"
            : "此單據已匯出,鎖定不可修改。"}
        </p>
      ) : (
        <form action={editAction} className="card">
          <input type="hidden" name="id" value={receipt.id} />
          <h2>核對欄位</h2>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="docType">單據類型</label>
              <select
                id="docType"
                className="select"
                name="docType"
                defaultValue={receipt.docType}
                disabled={receipt.docType === "einvoice"}
              >
                {docTypeOptions(receipt.docType).map((t) => (
                  <option key={t} value={t}>
                    {DOC_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              {receipt.docType === "einvoice" ? (
                <input type="hidden" name="docType" value="einvoice" />
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="invoiceDate">日期</label>
              <input
                id="invoiceDate"
                className="input"
                type="date"
                name="invoiceDate"
                defaultValue={receipt.invoiceDate ?? ""}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="sellerName">賣方名稱</label>
            <input
              id="sellerName"
              className="input"
              type="text"
              name="sellerName"
              defaultValue={receipt.sellerName ?? ""}
            />
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="amount">含稅金額({receipt.currency})</label>
              <input
                id="amount"
                className="input"
                type="text"
                name="amount"
                defaultValue={receipt.amount}
                inputMode="decimal"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="taxAmount">稅額</label>
              <input
                id="taxAmount"
                className="input"
                type="text"
                name="taxAmount"
                defaultValue={receipt.taxAmount ?? ""}
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="categoryId">分類</label>
            <select id="categoryId" className="select" name="categoryId" defaultValue={receipt.categoryId ?? ""}>
              <option value="">未分類</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <details>
            <summary className="small">統編與發票號碼</summary>
            <div className="stack stack-inset">
              <div className="field">
                <label htmlFor="sellerTaxId">賣方統編</label>
                <input
                  id="sellerTaxId"
                  className="input"
                  type="text"
                  name="sellerTaxId"
                  defaultValue={receipt.sellerTaxId ?? ""}
                  inputMode="numeric"
                />
              </div>
              <div className="field">
                <label htmlFor="buyerTaxId">買方統編</label>
                <input
                  id="buyerTaxId"
                  className="input"
                  type="text"
                  name="buyerTaxId"
                  defaultValue={receipt.buyerTaxId ?? ""}
                  inputMode="numeric"
                />
                <span className="field-hint">打公司統編才可扣抵進項稅。</span>
              </div>
              <div className="field">
                <label htmlFor="invoiceNumber">發票號碼</label>
                <input
                  id="invoiceNumber"
                  className="input"
                  type="text"
                  name="invoiceNumber"
                  defaultValue={receipt.invoiceNumber ?? ""}
                />
              </div>
            </div>
          </details>

          <div className="field">
            <label htmlFor="note">備註</label>
            <input id="note" className="input" type="text" name="note" defaultValue={receipt.note ?? ""} />
          </div>

          {editState.error ? <p className="error-text">{editState.error}</p> : null}

          <button type="submit" className="btn btn-block" disabled={editing}>
            {editing ? (
              <>
                <span className="spinner" aria-hidden="true" /> 儲存中…
              </>
            ) : (
              "儲存變更"
            )}
          </button>
        </form>
      )}

      {/* 次要動作放內容區;主要動作(確認入帳)在吸底列 */}
      <div className="row">
        {receipt.source === "ai" && receipt.status === "pending_review" && !recognizing ? (
          <form action={retryAction}>
            <input type="hidden" name="id" value={receipt.id} />
            <button type="submit" className="btn btn-sm" disabled={retrying}>
              {retrying ? "派送中…" : "重新辨識"}
            </button>
          </form>
        ) : null}

        {!readOnly ? (
          <form action={deleteAction}>
            <input type="hidden" name="id" value={receipt.id} />
            <button type="submit" className="btn btn-sm btn-danger" disabled={deleting}>
              {deleting ? "刪除中…" : "刪除"}
            </button>
          </form>
        ) : null}
      </div>

      {retryState.error ? <p className="error-text">{retryState.error}</p> : null}
      {deleteState.error ? <p className="error-text">{deleteState.error}</p> : null}
      {confirmState.error ? <p className="error-text">{confirmState.error}</p> : null}

      {/*
        確認入帳吸在底部:明細頁有影像 + 十幾個欄位,主要動作若跟著內容排,
        在手機上會被推到兩個螢幕以下(實際踩過)。
      */}
      {receipt.status === "pending_review" && !recognizing ? (
        <div className="actions-bar">
          <div className="actions-bar-inner">
            <form action={confirmAction}>
              <input type="hidden" name="id" value={receipt.id} />
              <button type="submit" className="btn btn-primary btn-block" disabled={confirming}>
                {confirming ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> 確認中…
                  </>
                ) : (
                  "確認入帳"
                )}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
