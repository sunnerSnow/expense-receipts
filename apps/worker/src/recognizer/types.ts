/**
 * 辨識供應商的抽換介面(見 ADR-0004)。
 *
 * 介面刻意只講「影像 + 提示 + 輸出 schema → JSON」,不提任何供應商概念,
 * 這樣換供應商(Gemini ↔ Claude ↔ 其他)只要多一個實作,job 與 core 都不用動。
 */

export interface RecognizeRequest {
  /** 單據影像的 base64(不含 data: 前綴) */
  imageBase64: string;
  mimeType: string;
  /** 由 core 的 buildRecognitionPrompt 產生 */
  prompt: string;
  /** 由 core 的 buildRecognitionJsonSchema 產生 */
  jsonSchema: object;
}

export interface RecognizeResponse {
  /** 模型回傳並 parse 過的 JSON;驗證交給 core 的 normalizeRecognition */
  data: unknown;
  /** 用了哪個模型(寫進 rawData 供追溯) */
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export interface ReceiptRecognizer {
  /** 供應商識別字串,例如 "gemini:gemini-3.5-flash" */
  readonly id: string;
  recognize(request: RecognizeRequest): Promise<RecognizeResponse>;
}

/**
 * 可重試的錯誤(網路、限流、供應商 5xx)—— 丟這個代表「值得再試一次」,
 * 由 job 決定要不要交回 pg-boss 重試。其他錯誤視為確定性失敗,直接交人工。
 */
export class TransientRecognitionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TransientRecognitionError";
  }
}
