/**
 * 辨識器連線檢查:`pnpm check:ai`
 *
 * 用途:確認 GEMINI_API_KEY 有效、模型名稱存在、請求形狀正確 —— 不必真的上傳
 * 一張單據就能驗證整條辨識管線。金鑰換發後也用這個確認。
 *
 * 送的是 1x1 白色 PNG,所以模型「讀不到任何欄位」是正確結果:重點是它有回應、
 * 且回的是符合 schema 的 JSON。
 */
import { buildRecognitionJsonSchema, buildRecognitionPrompt } from "@expense-receipts/core";
import { env } from "./env";
import { createRecognizer } from "./recognizer";

const BLANK_PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI/AL+4d1cAAAAAElFTkSuQmCC";

const recognizer = createRecognizer();
console.log(`檢查辨識器:${recognizer.id}`);

try {
  const res = await recognizer.recognize({
    imageBase64: BLANK_PNG_1X1,
    mimeType: "image/png",
    prompt: buildRecognitionPrompt({
      categories: [{ code: "misc", name: "雜費" }],
      companyTaxId: env.COMPANY_TAX_ID,
    }),
    jsonSchema: buildRecognitionJsonSchema(["misc"]),
  });
  console.log("✅ 連線正常,模型回傳合法 JSON");
  console.log("   回傳:", JSON.stringify(res.data));
  console.log("   token 用量:", JSON.stringify(res.usage ?? {}));
  console.log("(送的是空白圖,欄位全空是預期結果)");
} catch (err) {
  console.error(`❌ ${(err as Error).name}:${(err as Error).message}`);
  process.exit(1);
}
