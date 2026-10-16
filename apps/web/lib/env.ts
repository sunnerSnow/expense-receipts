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
    /**
     * 雲端中繼站(ADR-0009),**選填**。留空 = 功能關閉,離線頁的行為與 ADR-0008 相同。
     * 有設的話,手機連不到本機時會把照片送到這個網址。
     */
    RELAY_URL: z
      .string()
      .refine((v) => v === "" || /^https?:\/\/\S+$/.test(v), "RELAY_URL 須為 http(s) 網址,或留空(不用中繼站)")
      .optional(),
    // 簽上傳憑證用。必須與中繼站的同名 secret 一致,且**不得與 SESSION_SECRET 相同**(ADR-0009)
    RELAY_SECRET: z.string().optional(),
  }).superRefine((v, ctx) => {
    if (!v.RELAY_URL) return;
    if ((v.RELAY_SECRET ?? "").length < 32) {
      ctx.addIssue({
        code: "custom",
        path: ["RELAY_SECRET"],
        message: "有設 RELAY_URL 時,RELAY_SECRET 至少要 32 字元(與中繼站的設定一致)",
      });
    } else if (v.RELAY_SECRET === v.SESSION_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["RELAY_SECRET"],
        message: "RELAY_SECRET 不得與 SESSION_SECRET 相同:中繼站在第三方平台,外洩不能連帶偽造登入",
      });
    }
  }),
);

export const env = {
  ...raw,
  // 未設定與空字串都視為 null,下游只需判斷一種
  COMPANY_TAX_ID: raw.COMPANY_TAX_ID ? raw.COMPANY_TAX_ID : null,
  // 相對路徑一律以 monorepo 根目錄為基準,worker 才讀得到同一批影像/匯出檔
  UPLOAD_DIR: resolveFromRepoRoot(raw.UPLOAD_DIR),
  EXPORT_DIR: resolveFromRepoRoot(raw.EXPORT_DIR),
  // 留空 = 中繼站功能關閉。尾端斜線去掉,組路徑時才不會出現 //uploads
  RELAY_URL: raw.RELAY_URL ? raw.RELAY_URL.replace(/\/+$/, "") : null,
  RELAY_SECRET: raw.RELAY_SECRET ?? "",
};
