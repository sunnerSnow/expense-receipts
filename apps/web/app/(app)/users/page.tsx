import { asc } from "drizzle-orm";
import { users } from "@expense-receipts/db";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { UsersAdmin, type UserRow } from "./UsersAdmin";

export default async function UsersPage() {
  // 頁面與每個 action 各自檢查一次 —— server action 是可以被直接呼叫的端點
  const me = await requireAdmin();

  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      passwordHash: users.passwordHash,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  const list: UserRow[] = rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    // 只傳「有沒有密碼」到客戶端,雜湊本身不出伺服器
    hasPassword: u.passwordHash !== null,
    createdAt: u.createdAt.toISOString().slice(0, 10),
  }));

  return (
    <>
      <h1>使用者</h1>
      <p className="muted small">
        沒有寄信管道,所以密碼由這裡產生、由你轉達。對方登入後可以到「帳號」頁自己改。
      </p>

      <UsersAdmin rows={list} currentUserId={me.id} />
    </>
  );
}
