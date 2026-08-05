/**
 * 建立帳號或重設密碼。
 *
 *   pnpm user:password -- --email you@company.com --name 你的名字 --role admin
 *
 * 密碼優先讀環境變數 `NEW_PASSWORD`(不會留在 shell 歷史);沒給的話會隨機產生
 * 一組並印出來一次。刻意不做互動式輸入 —— 這個腳本也要能在部署腳本裡跑。
 *
 * 「忘記密碼」就用這個重設(見 ADR-0006:沒有寄信管道,不做寄信重設)。
 */
import { eq } from "drizzle-orm";
import { generatePassword, hashPassword } from "@expense-receipts/auth";
import { validatePassword } from "@expense-receipts/core";
import { createDb, users } from "../index";

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline?.slice(flag.length + 1);
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  if (!email) {
    console.error("用法:pnpm user:password -- --email you@company.com [--name 名字] [--role admin|member]");
    console.error("密碼:設環境變數 NEW_PASSWORD,或留空讓腳本產生一組");
    process.exit(1);
  }

  const roleArg = arg("role");
  if (roleArg && roleArg !== "admin" && roleArg !== "member") {
    console.error(`--role 只能是 admin 或 member(收到「${roleArg}」)`);
    process.exit(1);
  }

  const fromEnv = process.env.NEW_PASSWORD;
  const password = fromEnv && fromEnv !== "" ? fromEnv : generatePassword();

  const check = validatePassword(password);
  if (!check.ok) {
    console.error(`密碼不符規則:${check.error}`);
    process.exit(1);
  }

  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5433/expense_receipts",
  );

  const passwordHash = await hashPassword(password);
  const now = new Date();

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

  if (existing[0]) {
    await db
      .update(users)
      .set({ passwordHash, passwordUpdatedAt: now })
      .where(eq(users.id, existing[0].id));
    console.log(`已重設 ${email} 的密碼`);
  } else {
    await db.insert(users).values({
      email,
      name: arg("name") ?? email.split("@")[0] ?? email,
      role: roleArg === "admin" ? "admin" : "member",
      passwordHash,
      passwordUpdatedAt: now,
    });
    console.log(`已建立帳號 ${email}`);
  }

  if (!fromEnv) {
    console.log("");
    console.log(`  密碼:${password}`);
    console.log("");
    console.log("這組密碼只會顯示這一次,請立刻存到密碼管理器。");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
