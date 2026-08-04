import { GoogleGenAI } from "@google/genai";
import {
  TransientRecognitionError,
  type ReceiptRecognizer,
  type RecognizeRequest,
  type RecognizeResponse,
} from "./types";

/** 判斷是不是「再試一次可能就好」的錯誤(限流、逾時、供應商 5xx) */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("unavailable") ||
    msg.includes("deadline") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

/**
 * Google Gemini 辨識實作(@google/genai,Google AI Studio 金鑰)。
 *
 * 用 responseMimeType + responseJsonSchema 走 structured output:模型被迫回
 * 合法 JSON,省掉「從自然語言裡挖欄位」這種脆弱的解析。temperature 設 0 ——
 * 這是擷取任務不是創作,要的是同一張單據每次讀出同一個答案。
 */
export function createGeminiRecognizer(options: {
  apiKey: string;
  model: string;
}): ReceiptRecognizer {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  return {
    id: `gemini:${options.model}`,

    async recognize(request: RecognizeRequest): Promise<RecognizeResponse> {
      let text: string;
      let usage: RecognizeResponse["usage"];

      try {
        const response = await ai.models.generateContent({
          model: options.model,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: request.mimeType, data: request.imageBase64 } },
                { text: request.prompt },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseJsonSchema: request.jsonSchema,
            temperature: 0,
          },
        });

        text = response.text ?? "";
        const u = response.usageMetadata;
        usage = u
          ? {
              inputTokens: u.promptTokenCount,
              outputTokens: u.candidatesTokenCount,
              totalTokens: u.totalTokenCount,
            }
          : undefined;
      } catch (err) {
        // 錯誤訊息可能夾帶請求內容,不整包往外拋(避免金鑰或影像進 log)
        const message = (err as Error)?.message ?? "未知錯誤";
        if (isTransient(err)) {
          throw new TransientRecognitionError(`Gemini 暫時性錯誤:${message}`, err);
        }
        throw new Error(`Gemini 呼叫失敗:${message}`);
      }

      if (text.trim() === "") {
        // 空回應多半是安全過濾或截斷,重試通常無效 —— 當作確定性失敗交人工
        throw new Error("Gemini 回傳空內容(可能被安全過濾或影像無法辨識)");
      }

      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Gemini 回傳的不是合法 JSON");
      }

      return { data, model: options.model, usage };
    },
  };
}
