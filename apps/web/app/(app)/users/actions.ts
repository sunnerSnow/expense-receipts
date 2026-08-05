"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { users } from "@expense-receipts/db";
import { generatePassword, hashPassword } from "@expense-receipts/auth";
import { validatePassword } from "@expense-receipts/core";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

/**
 * 產生的密碼只回傳一次給畫面顯示,不存明碼。
 * 管理者要負責轉達給對方(沒有寄信管道,見 ADR-0006)。
 */
export type UserActionState = {
  error?: string;
  notice?: string;
  /** 剛產生的密碼,只在這一次回應裡出現 */
  generated?: { email: string; password: string };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(formData: FormData): string {
  return String(formData.get("email") ?? "").trim().toLowerCase();
}

/** 新增使用者。密碼可自訂,留空則自動產生一組並顯示一次。 */
export async function createUser(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  await requireAdmin();

  const email = readEmail(formData);
  const name = String(formData.get("name") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "member");

  if (!EMAIL_RE.test(email)) return { error: "email 格式不正確" };
  if (name === "") return { error: "請填寫名字" };
  if (roleRaw !== "admin" && roleRaw !== "member") return { error: "權限只能是管理者或成員" };

  const typed = String(formData.get("password") ?? "");
  const password = typed === "" ? generatePassword() : typed;
  const check = validatePassword(password);
  if (!check.ok) return { error: check.error };

  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return { error: "這個 email 已經有帳號了" };

  await db.insert(users).values({
    email,
    name,
    role: roleRaw,
    passwordHash: await hashPassword(password),
    passwordUpdatedAt: new Date(),
  });

  revalidatePath("/users");
  // 自訂密碼不回傳(管理者自己打的,已經知道);自動產生的才需要顯示
  return typed === "" ? { generated: { email, password } } : { notice: `已建立 ${email}` };
}

/** 重設某個使用者的密碼,產生新的一組並顯示一次 */
export async function resetUserPassword(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const db = getDb();
  const rows = await db.select({ email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  const target = rows[0];
  if (!target) return { error: "找不到這個使用者" };

  const password = generatePassword();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), passwordUpdatedAt: new Date() })
    .where(eq(users.id, id));

  revalidatePath("/users");
  return { generated: { email: target.email, password } };
}

/**
 * 切換權限。
 *
 * 兩個防呆:不能改自己的權限(避免把自己降級後沒人能管),
 * 也不能把最後一個管理者降級(避免整個系統沒有管理者)。
 */
export async function toggleUserRole(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const me = await requireAdmin();

  const id = String(formData.get("id") ?? "");
  if (id === me.id) return { error: "不能改自己的權限,請請另一位管理者處理" };

  const db = getDb();
  const rows = await db
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const target = rows[0];
  if (!target) return { error: "找不到這個使用者" };

  const nextRole = target.role === "admin" ? "member" : "admin";

  if (nextRole === "member") {
    const [remaining] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, "admin"), ne(users.id, id)));
    if ((remaining?.count ?? 0) === 0) {
      return { error: "這是最後一位管理者,不能降為成員" };
    }
  }

  await db.update(users).set({ role: nextRole }).where(eq(users.id, id));
  revalidatePath("/users");
  return { notice: `${target.email} 已改為${nextRole === "admin" ? "管理者" : "成員"}` };
}
