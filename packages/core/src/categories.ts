/**
 * 預設分類(會計科目式)。
 *
 * 這是 db seed 的資料來源;實際分類存在 DB,可增減改名。
 * AI 辨識(Phase 2)的分類建議也以 DB 中的現行清單為準,不是這份常數。
 */
export interface CategorySeed {
  code: string;
  name: string;
}

export const DEFAULT_CATEGORIES: readonly CategorySeed[] = [
  { code: "travel", name: "差旅費" },
  { code: "transport", name: "交通費" },
  { code: "meals", name: "伙食費" },
  { code: "entertainment", name: "交際費" },
  { code: "office_supplies", name: "文具用品" },
  { code: "postage", name: "郵電費" },
  { code: "utilities", name: "水電瓦斯費" },
  { code: "rent", name: "租金支出" },
  { code: "software", name: "軟體與雲端服務" },
  { code: "hardware", name: "設備與雜項購置" },
  { code: "insurance", name: "保險費" },
  { code: "misc", name: "雜費" },
];
