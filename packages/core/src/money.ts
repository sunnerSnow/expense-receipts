/**
 * 金額處理:DB 的 numeric(12,2) 讀出來是字串,運算一律先轉「分」的整數,
 * 避免浮點誤差(見 docs/conventions.md 第 6 節)。
 */

/** 是否為合法金額字串(非負,最多兩位小數) */
export function isValidAmount(s: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(s.trim());
}

/**
 * 金額字串/數字轉為「分」的整數。
 * 假設輸入為合法金額(邊界已用 isValidAmount 驗證);非法輸入回傳 0。
 */
export function amountToCents(amount: string | number): number {
  const s = (typeof amount === "number" ? amount.toString() : amount).trim();
  if (!isValidAmount(s)) return 0;
  const [intPart = "0", fracPart = ""] = s.split(".");
  return Number(intPart) * 100 + Number((fracPart + "00").slice(0, 2));
}

/** 「分」整數格式化為台幣顯示,例:105000 → "NT$1,050"、150 → "NT$1.50" */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = rem === 0 ? "" : "." + String(rem).padStart(2, "0");
  return `${neg ? "-" : ""}NT$${grouped}${fraction}`;
}
