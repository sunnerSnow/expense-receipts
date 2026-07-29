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
