/**
 * 密碼規則(純函式)。
 *
 * 放 core 是為了讓 web 的表單與 db 的 CLI 用**同一套**判斷 —— 不然 CLI 設得進去、
 * 網頁卻說不合格,或反過來。雜湊本身不在這裡(那需要 node:crypto,會弄壞瀏覽器端
 * 的編譯,見 ADR-0006 與 packages/auth)。
 *
 * 規則刻意偏「長度優先」而不是「大小寫加符號」:長度對暴力破解的貢獻遠大於
 * 字元種類,而後者只會讓人把密碼寫在便利貼上。
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/** 常見到不能用的密碼(小寫比對)。自用工具不需要幾萬條字典,擋掉最蠢的即可。 */
const BANNED = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "iloveyou",
  "letmein123",
  "administrator",
  "dev-session-secret-change-me",
  "admin@example.com",
]);

export type PasswordCheck = { ok: true } | { ok: false; error: string };

/** 驗證密碼是否可用。錯誤訊息直接給使用者看,所以要說「怎麼改」而不只是「不行」。 */
export function validatePassword(plain: string): PasswordCheck {
  // 不 trim:前後空白是密碼的一部分。但全空白顯然是誤填
  if (plain.trim() === "") {
    return { ok: false, error: "請輸入密碼" };
  }

  // 用 Unicode 字元數而不是 UTF-16 長度:中文密碼不該被高估長度
  const length = [...plain.normalize("NFKC")].length;

  if (length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `密碼至少要 ${PASSWORD_MIN_LENGTH} 個字(目前 ${length} 個)` };
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `密碼最多 ${PASSWORD_MAX_LENGTH} 個字` };
  }
  if (new Set([...plain]).size === 1) {
    return { ok: false, error: "密碼不能是同一個字重複" };
  }
  if (BANNED.has(plain.toLowerCase())) {
    return { ok: false, error: "這個密碼太常見,請換一個" };
  }

  return { ok: true };
}
