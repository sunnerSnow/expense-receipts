import { parseEnv, resolveFromRepoRoot, z } from "@expense-receipts/config";

/**
 * Google AI Studio 金鑰的兩種合法形式:
 * - `AQ.` 開頭:新的 authorization key(2026 起 AI Studio 一律發這種)
 * - `AIzaSy` + 33 碼:舊的 standard key(Google 公告 2026-09 起停止受理)
 *
 * 檢查形狀的理由:貼錯字串(例如把 SESSION_SECRET 貼進來)只會換到
 * Google 回一個 `400 API_KEY_INVALID`,看不出是自己貼錯 —— 在啟動時就講清楚。
 * 這裡只驗前綴形狀,不驗有效性(要驗跑 `pnpm check:ai`)。
 */
const GEMINI_KEY_SHAPE = /^(AQ\.[A-Za-z0-9_-]{10,}|AIzaSy[A-Za-z0-9_-]{33})$/;

const raw = parseEnv(
  z.object({
    DATABASE_URL: z.string().min(1),
    // AI 辨識(Phase 2)。金鑰只從環境變數讀,不寫死、不進 log(鐵律 8)
    GEMINI_API_KEY: z
      .string()
      .min(1, "Phase 2 AI 辨識需要 Gemini API 金鑰")
      .regex(
        GEMINI_KEY_SHAPE,
        "看起來不是 Google AI Studio 的 API 金鑰(應為 `AQ.` 或 `AIzaSy` 開頭)。" +
          "請確認貼的是 https://aistudio.google.com/apikey 產生的金鑰,而不是其他密鑰",
      ),
    GEMINI_MODEL: z.string().min(1),
    /**
     * 本公司統編,**選填**。只用來比對買方統編、判斷進項稅額可否扣抵。
     * 只報海外單據或不主張進項扣抵時留空即可(留空 → 一律交人工判斷)。
     */
    COMPANY_TAX_ID: z
      .string()
      .refine((v) => v === "" || /^\d{8}$/.test(v), "統編須為 8 碼數字,或留空(不做扣抵比對)")
      .optional(),
    // 單據影像目錄,worker 要讀檔送去辨識
    UPLOAD_DIR: z.string().min(1),
    // 月結匯出產出目錄(CSV + 影像 zip);web 也要讀來提供下載
    EXPORT_DIR: z.string().min(1),
    /**
     * 雲端中繼站(ADR-0009),**選填**。留空 = 不拉取。
     * 有設的話,worker 啟動時與每 5 分鐘去中繼站把照片拉回來建單。
     */
    RELAY_URL: z
      .string()
      .refine((v) => v === "" || /^https?:\/\/\S+$/.test(v), "RELAY_URL 須為 http(s) 網址,或留空(不用中繼站)")
      .optional(),
    // 拉取權杖:只能列出/取件/刪除。與中繼站的同名 secret 一致,不進 log(鐵律 8)
    RELAY_PULL_TOKEN: z.string().optional(),
  }).superRefine((v, ctx) => {
    if (v.RELAY_URL && (v.RELAY_PULL_TOKEN ?? "").length < 32) {
      ctx.addIssue({
        code: "custom",
        path: ["RELAY_PULL_TOKEN"],
        message: "有設 RELAY_URL 時,RELAY_PULL_TOKEN 至少要 32 字元(與中繼站的設定一致)",
      });
    }
  }),
);

export const env = {
  ...raw,
  // 未設定與空字串都視為 null,下游只需判斷一種
  COMPANY_TAX_ID: raw.COMPANY_TAX_ID ? raw.COMPANY_TAX_ID : null,
  // 與 web 用同一套解析規則,確保兩邊指向同一個目錄
  UPLOAD_DIR: resolveFromRepoRoot(raw.UPLOAD_DIR),
  EXPORT_DIR: resolveFromRepoRoot(raw.EXPORT_DIR),
  // 留空 = 不拉取
  RELAY_URL: raw.RELAY_URL ? raw.RELAY_URL : null,
  RELAY_PULL_TOKEN: raw.RELAY_PULL_TOKEN ?? "",
};
