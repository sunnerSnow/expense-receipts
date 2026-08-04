import { describe, expect, it } from "vitest";
import { summarizeReceipts, type ReceiptForStats } from "./stats";

/** 預設台幣單據,測試時只覆寫要驗的欄位 */
function r(over: Partial<ReceiptForStats> = {}): ReceiptForStats {
  return { categoryId: "a", amount: "100", currency: "TWD", deductibility: null, ...over };
}

describe("summarizeReceipts", () => {
  it("空陣列回傳零", () => {
    expect(summarizeReceipts([])).toEqual({
      count: 0,
      totalCents: 0,
      deductibleCents: 0,
      byCurrency: [],
      byCategory: [],
      hasForeignCurrency: false,
    });
  });

  it("加總總額與可扣抵合計", () => {
    const s = summarizeReceipts([
      r({ amount: "1050", deductibility: "deductible" }),
      r({ amount: "500", deductibility: "expense_only" }),
      r({ categoryId: "b", amount: "200.50", deductibility: "deductible" }),
    ]);
    expect(s.count).toBe(3);
    expect(s.totalCents).toBe(175050); // 1050 + 500 + 200.50
    expect(s.deductibleCents).toBe(125050); // 1050 + 200.50
    expect(s.hasForeignCurrency).toBe(false);
  });

  it("依分類小計,null 分類獨立成組", () => {
    const s = summarizeReceipts([
      r({ amount: "100" }),
      r({ amount: "50" }),
      r({ categoryId: null, amount: "30" }),
    ]);
    expect(s.byCategory).toEqual([
      { categoryId: "a", count: 2, totalCents: 15000 },
      { categoryId: null, count: 1, totalCents: 3000 },
    ]);
  });
});

describe("summarizeReceipts — 多幣別(海外出差)", () => {
  it("外幣不加進台幣總額(340 泰銖不是 340 台幣)", () => {
    const s = summarizeReceipts([
      r({ amount: "1000", deductibility: "deductible" }),
      r({ amount: "340", currency: "THB" }),
    ]);
    expect(s.totalCents).toBe(100000); // 只有台幣的 1000
    expect(s.deductibleCents).toBe(100000);
    expect(s.count).toBe(2); // 筆數仍含外幣
    expect(s.hasForeignCurrency).toBe(true);
  });

  it("各幣別分別小計,台幣排在最前面", () => {
    const s = summarizeReceipts([
      r({ amount: "340", currency: "THB" }),
      r({ amount: "1000" }),
      r({ amount: "121", currency: "THB" }),
      r({ amount: "500", currency: "JPY" }),
    ]);
    expect(s.byCurrency).toEqual([
      { currency: "TWD", count: 1, totalCents: 100000 },
      { currency: "THB", count: 2, totalCents: 46100 }, // 340 + 121
      { currency: "JPY", count: 1, totalCents: 50000 },
    ]);
  });

  it("分類小計只計台幣(外幣換算前加總沒有意義)", () => {
    const s = summarizeReceipts([
      r({ categoryId: "meals", amount: "200" }),
      r({ categoryId: "meals", amount: "340", currency: "THB" }),
    ]);
    expect(s.byCategory).toEqual([{ categoryId: "meals", count: 1, totalCents: 20000 }]);
  });

  it("幣別大小寫正規化,空字串視為台幣", () => {
    const s = summarizeReceipts([r({ amount: "100", currency: "thb" }), r({ amount: "200", currency: "" })]);
    expect(s.byCurrency).toEqual([
      { currency: "TWD", count: 1, totalCents: 20000 },
      { currency: "THB", count: 1, totalCents: 10000 },
    ]);
    expect(s.totalCents).toBe(20000);
  });
});
