"use client";

import { useActionState } from "react";
import { createCategory, type ActionState } from "./actions";

export function CreateCategoryForm() {
  const [state, action, pending] = useActionState(createCategory, {} as ActionState);

  return (
    <form action={action} className="card">
      <h2>新增分類</h2>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="c-code">代碼</label>
          <input
            id="c-code"
            className="input"
            name="code"
            required
            placeholder="travel"
            pattern="[a-z0-9_]+"
          />
          <span className="field-hint">小寫英數與底線,匯出時不顯示。</span>
        </div>
        <div className="field">
          <label htmlFor="c-name">名稱</label>
          <input id="c-name" className="input" name="name" required placeholder="差旅費" />
          <span className="field-hint">會計科目名稱,會出現在匯出清單。</span>
        </div>
      </div>
      {state.error ? <p className="error-text">{state.error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "新增中…" : "新增分類"}
      </button>
    </form>
  );
}
