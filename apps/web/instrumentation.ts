// 伺服器啟動時驗證環境變數(快速失敗,見 packages/config 的 parseEnv)
export async function register() {
  // Next 會把 instrumentation 同時編成 nodejs 與 edge 兩份;lib/env 會用到
  // node:fs(UPLOAD_DIR/EXPORT_DIR 的路徑解析),在 edge 編譯時會直接失敗。
  // NEXT_RUNTIME 是編譯期常數,這個判斷會讓 edge 那份把整段消掉。
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env");
  }
}
