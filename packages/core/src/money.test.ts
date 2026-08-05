import { describe, expect, it } from "vitest";
import { amountToCents, formatAmount, formatCents, isValidAmount } from "./money";

describe("formatAmount", () => {
  it("台幣掛 NT$ 前綴", () => {
    expect(formatAmount("1050", "TWD")).toBe("NT$1,050");
    expect(formatAmount("1103.50", "TWD")).toBe("NT$1,103.50");
  });

  it("空幣別視為台幣(舊資料防守)", () => {
    expect(formatAmount("200", "")).toBe("NT$200");
  });

  it("外幣改掛 ISO 代碼,不能掛 NT$", () => {
    expect(formatAmount("340.00", "THB")).toBe("THB 340");
    expect(formatAmount("1234.56", "usd")).toBe("USD 1,234.56");
    expect(formatAmount("340", "THB")).not.toContain("NT$");
  });

  it("千分位分組", () => {
    expect(formatAmount("1234567", "JPY")).toBe("JPY 1,234,567");
  });
});

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
