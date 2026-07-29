"use client";

import { useActionState } from "react";
import { createCategory, type ActionState } from "./actions";

export function CreateCategoryForm() {
  const [state, action, pending] = useActionState(createCategory, {} as ActionState);

  return (
    <form action={action} style={{ display: "flex", gap: "0.5rem", alignItems: "end", flexWrap: "wrap", marginBottom: "1rem" }}>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        代碼
        <input name="code" required placeholder="travel" pattern="[a-z0-9_]+" style={{ padding: "0.4rem" }} />
      </label>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        名稱
        <input name="name" required placeholder="差旅費" style={{ padding: "0.4rem" }} />
      </label>
      <button type="submit" disabled={pending} style={{ padding: "0.45rem 1rem" }}>
        新增
      </button>
      {state.error ? <span style={{ color: "#c0392b" }}>{state.error}</span> : null}
    </form>
  );
}
