import { describe, expect, it } from "vitest";
import { summarizeReceipts } from "./stats";

describe("summarizeReceipts", () => {
  it("空陣列回傳零", () => {
    const s = summarizeReceipts([]);
    expect(s).toEqual({ count: 0, totalCents: 0, deductibleCents: 0, byCategory: [] });
  });

  it("加總總額與可扣抵合計", () => {
    const s = summarizeReceipts([
      { categoryId: "a", amount: "1050", deductibility: "deductible" },
      { categoryId: "a", amount: "500", deductibility: "expense_only" },
      { categoryId: "b", amount: "200.50", deductibility: "deductible" },
    ]);
    expect(s.count).toBe(3);
    expect(s.totalCents).toBe(175050); // 1050 + 500 + 200.50
    expect(s.deductibleCents).toBe(125050); // 1050 + 200.50
  });

  it("依分類小計,null 分類獨立成組", () => {
    const s = summarizeReceipts([
      { categoryId: "a", amount: "100", deductibility: null },
      { categoryId: "a", amount: "50", deductibility: null },
      { categoryId: null, amount: "30", deductibility: null },
    ]);
    expect(s.byCategory).toEqual([
      { categoryId: "a", count: 2, totalCents: 15000 },
      { categoryId: null, count: 1, totalCents: 3000 },
    ]);
  });
});
