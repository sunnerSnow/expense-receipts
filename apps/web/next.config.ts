import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 建置輸出目錄,可用環境變數覆寫。
   *
   * 為什麼需要:對著同一個 `.next` 跑 production build 或砍掉它,會讓正在執行的
   * `next dev` 找不到自己的 chunk —— 頁面 HTML 還出得來,但所有 JS 變成
   * ERR_ABORTED、React 不會 hydrate,症狀是「按鈕點不動」這種很難聯想的錯。
   * 要在開發中並行驗證時,用 `NEXT_DIST_DIR=.next-verify` 開另一個目錄。
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // monorepo 根目錄(避免 Next 誤把家目錄的雜散 lockfile 當成 workspace root)
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  transpilePackages: [
    "@expense-receipts/auth",
    "@expense-receipts/config",
    "@expense-receipts/core",
    "@expense-receipts/db",
    "@expense-receipts/queue",
  ],
  experimental: {
    serverActions: {
      // 預設只有 1MB,但手機拍的單據照片常是 2–5MB,上傳會直接被擋下。
      // 上限訂 15MB:Gemini 的 inline 影像請求總量限制是 20MB,留餘裕給提示詞。
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
