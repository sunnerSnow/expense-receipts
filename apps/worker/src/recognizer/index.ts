import { env } from "../env";
import { createGeminiRecognizer } from "./gemini";
import type { ReceiptRecognizer } from "./types";

export {
  TransientRecognitionError,
  type ReceiptRecognizer,
  type RecognizeRequest,
  type RecognizeResponse,
} from "./types";

/**
 * 建立目前設定的辨識器。
 *
 * 只有一個實作時這個工廠看起來多餘,但它是「換供應商只改一處」的那一處
 * (ADR-0004);要比較兩家或搬回 Claude 時,這裡加分支即可。
 */
export function createRecognizer(): ReceiptRecognizer {
  return createGeminiRecognizer({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
}
