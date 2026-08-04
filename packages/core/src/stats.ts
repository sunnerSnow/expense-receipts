import { amountToCents } from "./money";
import type { Deductibility } from "./receipt";

/** 統計所需的最小單據形狀(對應 DB receipts 的子集) */
export interface ReceiptForStats {
  categoryId: string | null;
  amount: string;
  currency: string;
  deductibility: Deductibility | null;
}

export interface CategorySubtotal {
  categoryId: string | null;
  count: number;
  totalCents: number;
}

/** 單一幣別的小計(外幣單據金額存原幣,不能與台幣相加) */
export interface CurrencySubtotal {
  currency: string;
  count: number;
  totalCents: number;
}

export interface ReceiptSummary {
  count: number;
  /** 台幣總額。外幣單據**不含**在內 —— 見 byCurrency */
  totalCents: number;
  /** 可扣抵進項合計(deductibility === "deductible";必為台幣) */
  deductibleCents: number;
  /**
   * 各幣別小計,台幣在前、其餘依首見序。
   * 只有台幣單據時長度為 1;有外幣時 UI 要分開顯示,不可加總。
   */
  byCurrency: CurrencySubtotal[];
  /** 分類小計(只計台幣;外幣要換算後才有意義,見 docs/roadmap.md) */
  byCategory: CategorySubtotal[];
  /** 是否含外幣單據(UI 用來決定要不要提醒「另有外幣」) */
  hasForeignCurrency: boolean;
}

const BASE_CURRENCY = "TWD";

/**
 * 匯總一批單據:台幣總額、可扣抵合計、分類小計、各幣別小計。
 *
 * 為什麼要分幣別:海外出差的單據金額存的是原幣(THB 340 就是 340)。若直接
 * 全部相加,340 泰銖會被當成 340 台幣加進月總額 —— 數字錯了卻看起來很正常,
 * 是最危險的一種錯。這裡明確把台幣與外幣分開,換算匯率是報帳時的人工決定。
 *
 * 純函式,金額以「分」運算(見 money.ts)。小計保留輸入順序的首見序。
 */
export function summarizeReceipts(receipts: readonly ReceiptForStats[]): ReceiptSummary {
  let totalCents = 0;
  let deductibleCents = 0;
  const byCategory = new Map<string | null, CategorySubtotal>();
  const byCurrency = new Map<string, CurrencySubtotal>();

  for (const r of receipts) {
    const cents = amountToCents(r.amount);
    const currency = r.currency === "" ? BASE_CURRENCY : r.currency.toUpperCase();

    const currencyRow = byCurrency.get(currency);
    if (currencyRow) {
      currencyRow.count += 1;
      currencyRow.totalCents += cents;
    } else {
      byCurrency.set(currency, { currency, count: 1, totalCents: cents });
    }

    // 以下只累計台幣:外幣不換算,加起來沒有意義
    if (currency !== BASE_CURRENCY) continue;

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

  // 台幣排在最前面,其餘維持首見序
  const currencies = [...byCurrency.values()].sort((a, b) =>
    a.currency === BASE_CURRENCY ? -1 : b.currency === BASE_CURRENCY ? 1 : 0,
  );

  return {
    count: receipts.length,
    totalCents,
    deductibleCents,
    byCurrency: currencies,
    byCategory: [...byCategory.values()],
    hasForeignCurrency: currencies.some((c) => c.currency !== BASE_CURRENCY),
  };
}
