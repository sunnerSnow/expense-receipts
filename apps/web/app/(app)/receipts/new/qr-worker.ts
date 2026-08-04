/// <reference lib="webworker" />

/**
 * QR 解碼工作執行緒。
 *
 * 為什麼一定要放在 worker:jsQR 是**同步**運算,手機照片(1200 萬像素)掃一輪
 * 要好幾秒。跑在主執行緒上畫面會整個凍住 —— 使用者看到的就是「按鈕點不動」。
 * 搬到 worker 後主執行緒完全不受影響,才敢為了辨識率多掃一輪較大的尺寸。
 *
 * 只負責純運算:影像解碼與縮圖仍在主執行緒做(那部分是原生實作,很快),
 * 這裡收到的是已經縮好的像素陣列。
 */

import jsQR from "jsqr";

export interface QrDecodeRequest {
  /** RGBA 像素;用 transfer 傳進來避免複製 */
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

export type QrDecodeResponse = { text: string | null } | { error: string };

self.onmessage = (event: MessageEvent<QrDecodeRequest>) => {
  const { buffer, width, height } = event.data;
  try {
    const pixels = new Uint8ClampedArray(buffer);
    // dontInvert:單據是黑字白底,attemptBoth 會讓工作量加倍卻沒有幫助
    const code = jsQR(pixels, width, height, { inversionAttempts: "dontInvert" });
    const response: QrDecodeResponse = { text: code?.data ?? null };
    self.postMessage(response);
  } catch (err) {
    const response: QrDecodeResponse = { error: (err as Error)?.message ?? "解碼失敗" };
    self.postMessage(response);
  }
};
