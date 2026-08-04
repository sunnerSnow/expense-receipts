import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // monorepo 根目錄(避免 Next 誤把家目錄的雜散 lockfile 當成 workspace root)
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  transpilePackages: [
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
