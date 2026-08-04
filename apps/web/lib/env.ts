import "server-only";
import { parseEnv, resolveFromRepoRoot, z } from "@expense-receipts/config";

const raw = parseEnv(
  z.object({
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(16),
    COMPANY_TAX_ID: z.string().regex(/^\d{8}$/, "統編須為 8 碼數字"),
    UPLOAD_DIR: z.string().min(1),
  }),
);

export const env = {
  ...raw,
  // 相對路徑一律以 monorepo 根目錄為基準,worker 才讀得到同一批影像
  UPLOAD_DIR: resolveFromRepoRoot(raw.UPLOAD_DIR),
};
