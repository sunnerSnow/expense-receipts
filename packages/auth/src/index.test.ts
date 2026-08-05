import { describe, expect, it } from "vitest";
import { burnPasswordTime, hashPassword, verifyPassword } from "./index";

describe("hashPassword / verifyPassword", () => {
  it("正確密碼驗得過", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("錯誤密碼驗不過", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("Correct horse battery staple", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
  });

  it("同一個密碼每次雜湊都不同(有隨機 salt)", async () => {
    const a = await hashPassword("same-password-here");
    const b = await hashPassword("same-password-here");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password-here", a)).toBe(true);
    expect(await verifyPassword("same-password-here", b)).toBe(true);
  });

  it("儲存格式含參數,日後調成本不會讓舊雜湊失效", async () => {
    const stored = await hashPassword("whatever-password");
    const parts = stored.split("$");
    expect(parts[0]).toBe("scrypt");
    expect(parts).toHaveLength(6);
    expect(Number(parts[1])).toBeGreaterThanOrEqual(1 << 15);
  });

  it("用較低成本參數產生的舊雜湊仍驗得過", async () => {
    // 手工組一個 N=4096 的雜湊,模擬「以前用較低成本存的密碼」
    const { randomBytes, scryptSync } = await import("node:crypto");
    const salt = randomBytes(16);
    const key = scryptSync("legacy-password", salt, 64, { N: 4096, r: 8, p: 1 });
    const legacy = ["scrypt", 4096, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
    expect(await verifyPassword("legacy-password", legacy)).toBe(true);
    expect(await verifyPassword("wrong", legacy)).toBe(false);
  });

  it("中文與 emoji 密碼可用,並做 unicode 正規化", async () => {
    const stored = await hashPassword("報帳密碼🔐");
    expect(await verifyPassword("報帳密碼🔐", stored)).toBe(true);
    // NFD 與 NFC 的同一個字串要視為相同(不同輸入法可能產生不同組合)
    const decomposed = await hashPassword("é".normalize("NFD"));
    expect(await verifyPassword("é".normalize("NFC"), decomposed)).toBe(true);
  });
});

describe("verifyPassword — 壞掉或惡意的儲存字串", () => {
  it("格式不對一律回 false,不丟例外", async () => {
    for (const bad of [
      "",
      "not-a-hash",
      "scrypt$1$2$3",
      "bcrypt$32768$8$1$AA==$AA==",
      "scrypt$abc$8$1$AA==$AA==",
      "scrypt$32768$8$1$$",
    ]) {
      expect(await verifyPassword("x", bad), bad).toBe(false);
    }
  });

  it("離譜的成本參數被擋下,不會耗盡記憶體", async () => {
    // N 太大會讓 scrypt 吃掉大量記憶體 —— 這是被動過的字串,直接拒絕
    expect(await verifyPassword("x", "scrypt$1073741824$8$1$AA==$AA==")).toBe(false);
    expect(await verifyPassword("x", "scrypt$32768$99$1$AA==$AA==")).toBe(false);
  });
});

describe("burnPasswordTime", () => {
  it("帳號不存在時也要花掉相近的時間(避免用回應時間列舉帳號)", async () => {
    const stored = await hashPassword("some-real-password");

    const t1 = performance.now();
    await verifyPassword("guess", stored);
    const real = performance.now() - t1;

    const t2 = performance.now();
    await burnPasswordTime("guess");
    const fake = performance.now() - t2;

    // 不比絕對值(CI 機器抖動大),只要求同一個數量級
    expect(fake).toBeGreaterThan(real * 0.2);
  });
});
