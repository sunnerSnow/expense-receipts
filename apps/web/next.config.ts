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
  /**
   * standalone:把 server 與「真正用到的」node_modules 一起輸出成可自帶執行的
   * 目錄,容器裡不必再放整份 node_modules(映像從 GB 級降到百 MB 級)。
   * 對本機 `next start` 沒有影響,它仍然照常運作。
   */
  output: "standalone",
  // monorepo 根目錄(避免 Next 誤把家目錄的雜散 lockfile 當成 workspace root)。
  // standalone 也用它決定輸出的目錄結構,所以 workspace 套件才會被一起帶進去。
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
