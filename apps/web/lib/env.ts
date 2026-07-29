import "server-only";
import { parseEnv, z } from "@expense-receipts/config";

export const env = parseEnv(
  z.object({
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(16),
    COMPANY_TAX_ID: z.string().regex(/^\d{8}$/, "統編須為 8 碼數字"),
    UPLOAD_DIR: z.string().min(1),
  }),
);
