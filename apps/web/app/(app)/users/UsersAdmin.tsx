"use client";

import { useActionState } from "react";
import { PASSWORD_MIN_LENGTH } from "@expense-receipts/core";
import {
  createUser,
  resetUserPassword,
  toggleUserRole,
  type UserActionState,
} from "./actions";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  hasPassword: boolean;
  createdAt: string;
};

/** 剛產生的密碼:只出現這一次,講清楚不會再顯示 */
function GeneratedPassword({ email, password }: { email: string; password: string }) {
  return (
    <div className="banner banner-warn">
      <strong>{email} 的密碼</strong>
      <code className="generated-password tnum">{password}</code>
      <span className="small">
        這組密碼<strong>只顯示這一次</strong>,重新載入頁面就看不到了。請立刻轉達給對方,
        並提醒他登入後到「帳號」頁改成自己的密碼。
      </span>
    </div>
  );
}

export function UsersAdmin({ rows, currentUserId }: { rows: UserRow[]; currentUserId: string }) {
  const [createState, createAction, creating] = useActionState(createUser, {} as UserActionState);
  const [resetState, resetAction, resetting] = useActionState(
    resetUserPassword,
    {} as UserActionState,
  );
  const [roleState, roleAction, changingRole] = useActionState(
    toggleUserRole,
    {} as UserActionState,
  );

  return (
    <>
      {createState.generated ? <GeneratedPassword {...createState.generated} /> : null}
      {resetState.generated ? <GeneratedPassword {...resetState.generated} /> : null}
      {createState.notice ? <p className="ok-text">{createState.notice}</p> : null}
      {roleState.notice ? <p className="ok-text">{roleState.notice}</p> : null}
      {roleState.error ? <p className="error-text">{roleState.error}</p> : null}
      {resetState.error ? <p className="error-text">{resetState.error}</p> : null}

      <form action={createAction} className="card">
        <h2>新增使用者</h2>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="u-email">Email</label>
            <input
              id="u-email"
              className="input"
              type="email"
              name="email"
              required
              inputMode="email"
              placeholder="name@company.com"
            />
          </div>
          <div className="field">
            <label htmlFor="u-name">名字</label>
            <input id="u-name" className="input" type="text" name="name" required placeholder="王小明" />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="u-role">權限</label>
            <select id="u-role" className="select" name="role" defaultValue="member">
              <option value="member">成員</option>
              <option value="admin">管理者</option>
            </select>
            <span className="field-hint">管理者才能管理使用者。</span>
          </div>
          <div className="field">
            <label htmlFor="u-password">密碼</label>
            <input
              id="u-password"
              className="input"
              type="text"
              name="password"
              autoComplete="off"
              placeholder="留空自動產生"
            />
            <span className="field-hint">留空會產生一組好念的密碼,至少 {PASSWORD_MIN_LENGTH} 字。</span>
          </div>
        </div>

        {createState.error ? <p className="error-text">{createState.error}</p> : null}

        <button type="submit" className="btn btn-primary btn-block" disabled={creating}>
          {creating ? (
            <>
              <span className="spinner" aria-hidden="true" /> 建立中…
            </>
          ) : (
            "建立帳號"
          )}
        </button>
      </form>

      <h2>現有使用者({rows.length})</h2>
      <div className="list">
        {rows.map((u) => (
          <div className="item" key={u.id}>
            <span className="item-title">
              {u.name}
              {u.id === currentUserId ? <span className="chip chip-info">你</span> : null}
            </span>
            <span className="item-amount small muted tnum">{u.createdAt}</span>

            <span className="item-meta">
              <span className="tnum">{u.email}</span>
              <span className={u.role === "admin" ? "chip chip-ok" : "chip"}>
                {u.role === "admin" ? "管理者" : "成員"}
              </span>
              {u.hasPassword ? null : <span className="chip chip-danger">未設密碼,無法登入</span>}
            </span>

            <span className="item-meta">
              <form action={resetAction}>
                <input type="hidden" name="id" value={u.id} />
                <button type="submit" className="btn btn-sm" disabled={resetting}>
                  重設密碼
                </button>
              </form>
              {u.id === currentUserId ? null : (
                <form action={roleAction}>
                  <input type="hidden" name="id" value={u.id} />
                  <button type="submit" className="btn btn-sm" disabled={changingRole}>
                    改為{u.role === "admin" ? "成員" : "管理者"}
                  </button>
                </form>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
