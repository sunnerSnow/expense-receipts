import "server-only";
import { parseEnv, resolveFromRepoRoot, z } from "@expense-receipts/config";

/**
 * 公司統編是**選填**:只用來比對買方統編、判斷進項稅額可否扣抵。
 * 只報海外單據(統編永遠不是台灣的)或不主張進項扣抵時,留空即可 ——
 * 留空時所有「有買方統編的統一發票」會落在 review 交人工判斷,不會亂猜。
 */
const OPTIONAL_TAX_ID = z
  .string()
  .refine((v) => v === "" || /^\d{8}$/.test(v), "統編須為 8 碼數字,或留空(不做扣抵比對)")
  .optional();

const raw = parseEnv(
  z.object({
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(16),
    COMPANY_TAX_ID: OPTIONAL_TAX_ID,
    UPLOAD_DIR: z.string().min(1),
    EXPORT_DIR: z.string().min(1),
  }),
);

export const env = {
  ...raw,
  // 未設定與空字串都視為 null,下游只需判斷一種
  COMPANY_TAX_ID: raw.COMPANY_TAX_ID ? raw.COMPANY_TAX_ID : null,
  // 相對路徑一律以 monorepo 根目錄為基準,worker 才讀得到同一批影像/匯出檔
  UPLOAD_DIR: resolveFromRepoRoot(raw.UPLOAD_DIR),
  EXPORT_DIR: resolveFromRepoRoot(raw.EXPORT_DIR),
};
