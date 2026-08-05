import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH, validatePassword } from "./password";

function reject(plain: string): string {
  const r = validatePassword(plain);
  if (r.ok) throw new Error(`預期被拒但通過了:${plain}`);
  return r.error;
}

describe("validatePassword", () => {
  it("足夠長的密碼通過", () => {
    expect(validatePassword("uanalyze-2026-report")).toEqual({ ok: true });
    // 剛好 10 個中文字 —— 中文按字元數算,不因 UTF-16 被高估
    expect(validatePassword("我的報帳系統登入密碼")).toEqual({ ok: true });
  });

  it("空白或全空白被拒", () => {
    expect(reject("")).toBe("請輸入密碼");
    expect(reject("     ")).toBe("請輸入密碼");
  });

  it("太短被拒,並告知目前長度", () => {
    const err = reject("short1");
    expect(err).toContain(String(PASSWORD_MIN_LENGTH));
    expect(err).toContain("目前 6 個");
  });

  it("中文按字元數算長度,不因 UTF-16 被高估", () => {
    // 8 個中文字 = 8 個字元,仍然不足 10
    expect(reject("我的報帳系統密碼碼碼".slice(0, 8))).toContain("目前 8 個");
    // emoji 是單一字元
    expect(reject("🔐🔐🔐")).toContain("目前 3 個");
  });

  it("同一個字重複被拒", () => {
    expect(reject("aaaaaaaaaaaa")).toBe("密碼不能是同一個字重複");
  });

  it("常見弱密碼被拒(不分大小寫)", () => {
    expect(reject("password123")).toBe("這個密碼太常見,請換一個");
    expect(reject("PASSWORD123")).toBe("這個密碼太常見,請換一個");
    expect(reject("1234567890")).toBe("這個密碼太常見,請換一個");
  });

  it("開發預設值不能當密碼用", () => {
    expect(reject("dev-session-secret-change-me")).toBe("這個密碼太常見,請換一個");
  });

  it("前後空白保留,不當作誤填", () => {
    expect(validatePassword(" my long password ")).toEqual({ ok: true });
  });

  it("過長被拒", () => {
    expect(reject("a".repeat(150) + "b".repeat(60))).toContain("最多");
  });
});
