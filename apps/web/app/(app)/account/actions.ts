"use server";

import { eq } from "drizzle-orm";
import { users } from "@expense-receipts/db";
import { hashPassword, verifyPassword } from "@expense-receipts/auth";
import { validatePassword } from "@expense-receipts/core";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export type ChangePasswordState = { error?: string; done?: boolean };

/**
 * 改密碼。
 *
 * 要求輸入目前密碼:cookie 被別人拿到時,至少不能直接把密碼改掉鎖住本人。
 * 規則走 core 的 validatePassword,與 CLI 同一套判斷(見 ADR-0006)。
 */
export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireUser();

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (next !== confirm) return { error: "兩次輸入的新密碼不一樣" };

  const check = validatePassword(next);
  if (!check.ok) return { error: check.error };

  const db = getDb();
  const rows = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const stored = rows[0]?.passwordHash;
  if (!stored) return { error: "這個帳號還沒設定密碼,請管理者用 CLI 設定" };
  if (!(await verifyPassword(current, stored))) return { error: "目前的密碼不正確" };
  if (await verifyPassword(next, stored)) return { error: "新密碼與目前的密碼相同" };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next), passwordUpdatedAt: new Date() })
    .where(eq(users.id, user.id));

  return { done: true };
}
