"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main>
      <div className="stack-sm">
        <h1>報帳單據</h1>
        <p className="muted">拍照上傳、AI 辨識、月結匯出給會計。</p>
      </div>

      <form action={formAction} className="card">
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            name="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
          />
          <span className="field-hint">用已建立的帳號 email 登入。</span>
        </div>

        {state.error ? <p className="error-text">{state.error}</p> : null}

        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? (
            <>
              <span className="spinner" aria-hidden="true" /> 登入中…
            </>
          ) : (
            "登入"
          )}
        </button>
      </form>
    </main>
  );
}
