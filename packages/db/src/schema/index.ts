import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// enum 值與 packages/core/src/receipt.ts 手動保持同步(db 與 core 互不依賴)。

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", { enum: ["admin", "member"] })
    .notNull()
    .default("member"),
  /**
   * scrypt 雜湊(格式見 packages/auth)。
   *
   * 可為 NULL 只是為了讓 migration 不用停機 —— **NULL 的帳號不能登入**,
   * 不是無密碼後門(見 ADR-0006)。要用 `pnpm user:password` 設一次。
   */
  passwordHash: text("password_hash"),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exportBatches = pgTable("export_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  /** 匯出清單 CSV 的路徑 */
  filePath: text("file_path"),
  /** 憑證影像 zip 的路徑 */
  imageZipPath: text("image_zip_path"),
  /** 這批匯出的單據筆數 */
  receiptCount: integer("receipt_count").notNull().default(0),
  /**
   * 各幣別小計,如 `{"TWD":"12345.00","THB":"461.00"}`。
   * 不換算台幣 —— 匯率由會計自行決定(見 ADR-0005)。
   */
  currencyTotals: jsonb("currency_totals").$type<Record<string, string>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id),
    // 為未來個人模式留的門;目前一律 company
    context: text("context", { enum: ["company", "personal"] })
      .notNull()
      .default("company"),
    docType: text("doc_type", {
      enum: ["einvoice", "triplicate", "duplicate", "cash_register", "receipt", "foreign", "other"],
    }).notNull(),
    source: text("source", { enum: ["qr", "ai", "manual"] }).notNull(),
    // pending_review → confirmed → exported(單向;轉換規則在 core 的 canTransitionStatus)
    status: text("status", { enum: ["pending_review", "confirmed", "exported"] })
      .notNull()
      .default("pending_review"),
    invoiceNumber: text("invoice_number"),
    invoiceDate: date("invoice_date"),
    sellerName: text("seller_name"),
    sellerTaxId: text("seller_tax_id"),
    buyerTaxId: text("buyer_tax_id"),
    currency: text("currency").notNull().default("TWD"),
    /** 含稅總額;國外單據為原幣金額 */
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }),
    deductibility: text("deductibility", { enum: ["deductible", "expense_only", "review"] }),
    categoryId: uuid("category_id").references(() => categories.id),
    note: text("note"),
    /** AI 辨識工作狀態(見 core 的 RECOGNITION_STATUSES);非 AI 單據為 none */
    recognitionStatus: text("recognition_status", {
      enum: ["none", "queued", "succeeded", "failed"],
    })
      .notNull()
      .default("none"),
    /** 辨識失敗原因(給人看的訊息;成功時為 null) */
    recognitionError: text("recognition_error"),
    /** 辨識結果中需要人工特別核對的提示(core 的 normalizeRecognition 產出) */
    recognitionWarnings: jsonb("recognition_warnings").$type<string[]>(),
    /** 憑證影像路徑;報帳憑證只增不刪 */
    imagePath: text("image_path"),
    /** 辨識原始資料(QR 原文或 AI 回傳 JSON),供追溯與除錯 */
    rawData: jsonb("raw_data"),
    exportBatchId: uuid("export_batch_id").references(() => exportBatches.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 去重:同一張發票(拍照 + 匯入)只能入帳一次;無發票號碼的收據不受限
    uniqueIndex("receipts_invoice_number_unique")
      .on(t.invoiceNumber)
      .where(sql`invoice_number IS NOT NULL`),
    index("receipts_status_idx").on(t.status),
    index("receipts_invoice_date_idx").on(t.invoiceDate),
    index("receipts_category_idx").on(t.categoryId),
  ],
);
