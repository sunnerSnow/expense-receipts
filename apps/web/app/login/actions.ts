"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users } from "@expense-receipts/db";
import { burnPasswordTime, verifyPassword } from "@expense-receipts/auth";
import { getDb } from "@/lib/db";
import { signSession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";

const MAX_AGE_SEC = 30 * 24 * 60 * 60;

/**
 * 登入失敗一律回同一句話。
 *
 * 不分辨「email 不存在」與「密碼錯誤」:分開講等於提供列舉帳號的管道。
 * 同理,帳號不存在時也要跑一次假雜湊比對(burnPasswordTime),
 * 否則回應時間本身就會洩漏帳號存在與否。
 */
const GENERIC_ERROR = "email 或密碼不正確";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (email === "" || password === "") return { error: "請輸入 email 與密碼" };

  const rows = await getDb()
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const user = rows[0];

  if (!user) {
    await burnPasswordTime(password);
    return { error: GENERIC_ERROR };
  }

  if (user.passwordHash === null) {
    await burnPasswordTime(password);
    // 這個訊息不洩漏什麼(對方已經知道自己的 email),而且說了才有辦法解決
    return { error: "這個帳號還沒設定密碼,請管理者用 pnpm user:password 設定" };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    return { error: GENERIC_ERROR };
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, signSession(user.id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
    secure: process.env.NODE_ENV === "production",
  });

  redirect("/receipts");
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
