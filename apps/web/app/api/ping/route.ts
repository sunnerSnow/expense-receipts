/**
 * 「伺服器活著嗎」的探針。
 *
 * 為什麼不能只看 `navigator.onLine`:它回報的是「這台裝置有沒有網路介面」,
 * 不是「連不連得到我們的伺服器」。這個系統最常見的離線情境正好是
 * **手機有 4G、但辦公室那台電腦沒開** —— 那時 `navigator.onLine` 是 true,
 * 畫面卻不該告訴使用者「目前有網路」。
 *
 * 刻意不驗登入:它只證明伺服器在,不吐任何資料。要求登入反而會讓
 * 「session 過期」被誤判成「連不到」。
 */
export async function GET(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
