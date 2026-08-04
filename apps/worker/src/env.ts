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
    // 判斷進項稅額可否扣抵要比對本公司統編
    COMPANY_TAX_ID: z.string().regex(/^\d{8}$/, "統編須為 8 碼數字"),
    // 單據影像目錄,worker 要讀檔送去辨識
    UPLOAD_DIR: z.string().min(1),
    // 月結匯出產出目錄(CSV + 影像 zip);web 也要讀來提供下載
    EXPORT_DIR: z.string().min(1),
  }),
);

export const env = {
  ...raw,
  // 與 web 用同一套解析規則,確保兩邊指向同一個目錄
  UPLOAD_DIR: resolveFromRepoRoot(raw.UPLOAD_DIR),
  EXPORT_DIR: resolveFromRepoRoot(raw.EXPORT_DIR),
};
