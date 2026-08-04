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
};

export default nextConfig;
