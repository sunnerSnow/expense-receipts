"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { categories } from "@expense-receipts/db";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export type ActionState = { error?: string };

const CODE_RE = /^[a-z0-9_]+$/;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** 新增分類(useActionState 版,顯示重複代碼錯誤)。code 是穩定鍵,建立後不可改 */
export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const code = str(formData, "code").toLowerCase();
  const name = str(formData, "name");
  if (!CODE_RE.test(code)) return { error: "代碼須為小寫英數與底線" };
  if (name === "") return { error: "請輸入分類名稱" };

  const db = getDb();
  const existing = await db.select({ id: categories.id }).from(categories).where(eq(categories.code, code)).limit(1);
  if (existing.length > 0) return { error: "此代碼已存在" };

  const maxRow = await db.select({ max: sql<number>`coalesce(max(${categories.sortOrder}), -1)` }).from(categories);
  const nextOrder = (maxRow[0]?.max ?? -1) + 1;

  await db.insert(categories).values({ code, name, sortOrder: nextOrder });
  revalidatePath("/categories");
  return {};
}

/** 改名(code 不動)。plain form-action */
export async function renameCategory(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (name === "") return;

  await getDb().update(categories).set({ name }).where(eq(categories.id, id));
  revalidatePath("/categories");
}

/** 啟用/停用切換。停用的分類不出現在選單,但既有單據關聯保留。plain form-action */
export async function toggleCategory(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const rows = await getDb().select({ isActive: categories.isActive }).from(categories).where(eq(categories.id, id)).limit(1);
  const current = rows[0];
  if (!current) return;

  await getDb().update(categories).set({ isActive: !current.isActive }).where(eq(categories.id, id));
  revalidatePath("/categories");
}
