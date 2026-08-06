import { z } from "zod";

export { z };
export { resolveFromRepoRoot, resolveStoredFile } from "./paths";

/**
 * 環境變數的「快速失敗」驗證(取代裸 process.env.X)。
 *
 * 動機:缺變數或格式錯誤要在程序啟動當下就爆掉,並一次列出所有問題,
 * 而不是跑到一半才拿到 undefined。
 *
 * 各 app / package 定義自己需要的欄位,不共用一份大 schema
 * —— web 要 SESSION_SECRET、worker 要 ANTHROPIC_API_KEY,需求本來就不同。
 *
 * @param schema 由呼叫端用 `z.object({...})` 定義的環境變數形狀
 * @param source 預設讀 process.env;測試時可注入替身
 */
export function parseEnv<T>(
  schema: z.ZodType<T>,
  source: Record<string, string | undefined> = process.env,
): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `環境變數驗證失敗:\n${issues}\n請對照 .env.example 檢查你的 .env`,
    );
  }
  return result.data;
}
