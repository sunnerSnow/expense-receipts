// 伺服器啟動時驗證環境變數(快速失敗,見 packages/config 的 parseEnv)
export async function register() {
  await import("./lib/env");
}
