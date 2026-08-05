import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users } from "@expense-receipts/db";
import { getDb } from "./db";
import { verifySession } from "./session";

export const SESSION_COOKIE = "er_session";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const userId = verifySession(token);
  if (!userId) return null;

  const rows = await getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return rows[0] ?? null;
}

/** 未登入則導向 /login;回傳當前使用者 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * 要求管理者權限。
 *
 * **每個 server action 都要自己呼叫一次**,不能只靠頁面擋 —— server action 是
 * 可以被直接呼叫的端點,「畫面上沒有按鈕」不等於「動作不能被觸發」。
 *
 * 非管理者導回單據列表而不是回錯誤:對方本來就不該知道這個頁面存在。
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/receipts");
  return user;
}
