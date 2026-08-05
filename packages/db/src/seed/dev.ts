/**
 * 開發用種子資料:預設分類 + 一個 admin 使用者。
 * 執行:pnpm --filter @expense-receipts/db seed
 */
import { hashPassword } from "@expense-receipts/auth";
import { createDb, categories, users } from "../index";

// 與 packages/core/src/categories.ts 的 DEFAULT_CATEGORIES 同步
const DEFAULT_CATEGORIES = [
  { code: "travel", name: "差旅費" },
  { code: "transport", name: "交通費" },
  { code: "meals", name: "伙食費" },
  { code: "entertainment", name: "交際費" },
  { code: "office_supplies", name: "文具用品" },
  { code: "postage", name: "郵電費" },
  { code: "utilities", name: "水電瓦斯費" },
  { code: "rent", name: "租金支出" },
  { code: "software", name: "軟體與雲端服務" },
  { code: "hardware", name: "設備與雜項購置" },
  { code: "insurance", name: "保險費" },
  { code: "misc", name: "雜費" },
];

async function main() {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5433/expense_receipts",
  );

  await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })))
    .onConflictDoNothing();

  /**
   * admin 帳號一併設密碼:沒有密碼的帳號登入不了(見 ADR-0006),
   * seed 出一個進不去的帳號等於沒 seed。
   *
   * 密碼從 SEED_ADMIN_PASSWORD 讀,沒設就用開發預設值 —— 這個預設值會出現在
   * 版控裡,**只能用於本機開發**,部署前務必用 `pnpm user:password` 換掉。
   */
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "dev-admin-password-1234";
  // email 也可設定:避免把個人 email 寫進版控,也讓部署腳本能直接建正式帳號
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
  await db
    .insert(users)
    .values({
      email: adminEmail,
      name: "Admin",
      role: "admin",
      passwordHash: await hashPassword(adminPassword),
      passwordUpdatedAt: new Date(),
    })
    .onConflictDoNothing();

  console.log("seed 完成");
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`${adminEmail} 的開發密碼:${adminPassword}(僅限本機,部署前請換掉)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
