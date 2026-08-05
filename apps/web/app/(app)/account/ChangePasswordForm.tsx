"use client";

import { useActionState } from "react";
import { PASSWORD_MIN_LENGTH } from "@expense-receipts/core";
import { changePassword, type ChangePasswordState } from "./actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {} as ChangePasswordState);

  return (
    <form action={action} className="card">
      <h2>更改密碼</h2>

      <div className="field">
        <label htmlFor="currentPassword">目前的密碼</label>
        <input
          id="currentPassword"
          className="input"
          type="password"
          name="currentPassword"
          required
          autoComplete="current-password"
        />
      </div>

      <div className="field">
        <label htmlFor="newPassword">新密碼</label>
        <input
          id="newPassword"
          className="input"
          type="password"
          name="newPassword"
          required
          autoComplete="new-password"
        />
        <span className="field-hint">至少 {PASSWORD_MIN_LENGTH} 個字。長比複雜有用,用一句話當密碼。</span>
      </div>

      <div className="field">
        <label htmlFor="confirmPassword">再輸入一次新密碼</label>
        <input
          id="confirmPassword"
          className="input"
          type="password"
          name="confirmPassword"
          required
          autoComplete="new-password"
        />
      </div>

      {state.error ? <p className="error-text">{state.error}</p> : null}
      {state.done ? <p className="ok-text">密碼已更新。下次登入請用新密碼。</p> : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? (
          <>
            <span className="spinner" aria-hidden="true" /> 更新中…
          </>
        ) : (
          "更新密碼"
        )}
      </button>
    </form>
  );
}
