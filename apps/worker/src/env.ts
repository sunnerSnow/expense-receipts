import { parseEnv, z } from "@expense-receipts/config";

export const env = parseEnv(
  z.object({
    DATABASE_URL: z.string().min(1),
    // Phase 2 AI 辨識啟用後改為必填
    ANTHROPIC_API_KEY: z.string().optional(),
  }),
);
