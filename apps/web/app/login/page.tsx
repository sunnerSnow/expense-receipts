"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main>
      <h1>報帳單據</h1>
      <p>請以已註冊的 email 登入。</p>
      <form action={formAction} style={{ display: "grid", gap: "0.75rem", maxWidth: 320 }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            style={{ padding: "0.5rem", fontSize: "1rem" }}
          />
        </label>
        {state.error ? <p style={{ color: "#c0392b", margin: 0 }}>{state.error}</p> : null}
        <button type="submit" disabled={pending} style={{ padding: "0.5rem", fontSize: "1rem" }}>
          {pending ? "登入中…" : "登入"}
        </button>
      </form>
    </main>
  );
}
