import { amountToCents } from "./money";
import type { Deductibility } from "./receipt";

/** 統計所需的最小單據形狀(對應 DB receipts 的子集) */
export interface ReceiptForStats {
  categoryId: string | null;
  amount: string;
  deductibility: Deductibility | null;
}

export interface CategorySubtotal {
  categoryId: string | null;
  count: number;
  totalCents: number;
}

export interface ReceiptSummary {
  count: number;
  totalCents: number;
  /** 可扣抵進項的合計(deductibility === "deductible") */
  deductibleCents: number;
  byCategory: CategorySubtotal[];
}

/**
 * 匯總一批單據:總額、可扣抵合計、分類小計。
 * 純函式,金額以「分」運算(見 money.ts)。分類小計保留輸入順序的首見序。
 */
export function summarizeReceipts(receipts: readonly ReceiptForStats[]): ReceiptSummary {
  let totalCents = 0;
  let deductibleCents = 0;
  const byCategory = new Map<string | null, CategorySubtotal>();

  for (const r of receipts) {
    const cents = amountToCents(r.amount);
    totalCents += cents;
    if (r.deductibility === "deductible") deductibleCents += cents;

    const existing = byCategory.get(r.categoryId);
    if (existing) {
      existing.count += 1;
      existing.totalCents += cents;
    } else {
      byCategory.set(r.categoryId, { categoryId: r.categoryId, count: 1, totalCents: cents });
    }
  }

  return {
    count: receipts.length,
    totalCents,
    deductibleCents,
    byCategory: [...byCategory.values()],
  };
}
