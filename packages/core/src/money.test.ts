import { describe, expect, it } from "vitest";
import { amountToCents, formatCents, isValidAmount } from "./money";

describe("isValidAmount", () => {
  it("接受非負、最多兩位小數", () => {
    expect(isValidAmount("1050")).toBe(true);
    expect(isValidAmount("1050.5")).toBe(true);
    expect(isValidAmount("1050.50")).toBe(true);
    expect(isValidAmount("0")).toBe(true);
  });
  it("拒絕負數、三位小數、非數字", () => {
    expect(isValidAmount("-5")).toBe(false);
    expect(isValidAmount("1.234")).toBe(false);
    expect(isValidAmount("abc")).toBe(false);
    expect(isValidAmount("")).toBe(false);
  });
});

describe("amountToCents", () => {
  it("整數與小數都轉成分", () => {
    expect(amountToCents("1050")).toBe(105000);
    expect(amountToCents("1050.00")).toBe(105000);
    expect(amountToCents("1050.5")).toBe(105050);
    expect(amountToCents("0.99")).toBe(99);
    expect(amountToCents(1050)).toBe(105000);
  });
  it("非法輸入回傳 0", () => {
    expect(amountToCents("abc")).toBe(0);
    expect(amountToCents("")).toBe(0);
  });
});

describe("formatCents", () => {
  it("整數金額不顯示小數,加千分位", () => {
    expect(formatCents(105000)).toBe("NT$1,050");
    expect(formatCents(1234567800)).toBe("NT$12,345,678");
    expect(formatCents(0)).toBe("NT$0");
  });
  it("有零頭時顯示兩位小數", () => {
    expect(formatCents(150)).toBe("NT$1.50");
    expect(formatCents(105050)).toBe("NT$1,050.50");
  });
  it("負數加負號", () => {
    expect(formatCents(-105000)).toBe("-NT$1,050");
  });
});
