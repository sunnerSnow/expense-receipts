import { parseEnv, resolveFromRepoRoot, z } from "@expense-receipts/config";

const raw = parseEnv(
  z.object({
    DATABASE_URL: z.string().min(1),
    // AI 辨識(Phase 2)。金鑰只從環境變數讀,不寫死、不進 log(鐵律 8)
    GEMINI_API_KEY: z.string().min(1, "Phase 2 AI 辨識需要 Gemini API 金鑰"),
    GEMINI_MODEL: z.string().min(1),
    // 判斷進項稅額可否扣抵要比對本公司統編
    COMPANY_TAX_ID: z.string().regex(/^\d{8}$/, "統編須為 8 碼數字"),
    // 單據影像目錄,worker 要讀檔送去辨識
    UPLOAD_DIR: z.string().min(1),
  }),
);

export const env = {
  ...raw,
  // 與 web 用同一套解析規則,確保兩邊指向同一個影像目錄
  UPLOAD_DIR: resolveFromRepoRoot(raw.UPLOAD_DIR),
};
