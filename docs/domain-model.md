# Domain Model

隨時反映現狀的系統地圖。動到資料模型時同步更新這份文件。

## 實體

```
users ──< receipts >── categories
              │
              └──>── export_batches(nullable,匯出後回填)
```

### users

系統使用者。`role`:admin(可匯出、看全部)/ member(上傳與管理自己的單據)。

### categories

會計科目式分類,可自訂。預設清單見 `packages/core/src/categories.ts`,
由 db seed 寫入;AI 分類建議以 DB 現行清單為準。

### receipts(核心表)

一張單據一列。關鍵欄位:

| 欄位 | 意義 |
|---|---|
| `context` | company / personal —— 個人模式的門,目前一律 company |
| `doc_type` | einvoice / triplicate / duplicate / cash_register / receipt / foreign / other |
| `source` | qr(QR 解析)/ ai(Claude 辨識)/ manual(手動 key) |
| `status` | pending_review → confirmed → exported(單向) |
| `invoice_number` | 發票號碼;部分唯一索引做去重(NULL 不受限,收據可無號碼) |
| `amount` / `tax_amount` | 含稅總額 / 稅額,numeric(12,2);國外單據存原幣 + currency |
| `deductibility` | deductible / expense_only / review,由 core 的 assessDeductibility 判定 |
| `image_path` | 憑證影像;只增不刪 |
| `raw_data` | 辨識原始資料(QR 原文或 AI 回傳 JSON),追溯用 |

### export_batches

一次月結匯出一列(期間 + 產出檔路徑)。只允許 INSERT。
被匯出的單據回填 `export_batch_id` 並轉 exported。

## 狀態機

```
pending_review ──確認──▶ confirmed ──月結匯出──▶ exported(終態)
```

- 轉換規則的唯一出口:`packages/core` 的 `canTransitionStatus()`
- source='qr' 建立時直接 confirmed(QR 資料 100% 準確)
- source='manual' 建立時直接 confirmed(上傳者當場輸入即已核對,自用免二次確認)
- source='ai'(Phase 2)一律從 pending_review 開始,必經人工確認才 confirmed

## 不變量(依執行強度排序,見 engineering-playbook 第二節)

| 不變量 | 下沉層級 |
|---|---|
| 發票號碼不重複入帳 | DB 部分唯一索引 `receipts_invoice_number_unique` |
| 狀態不跳關、不回頭 | core `canTransitionStatus()` + 單元測試 |
| exported 單據不可改 | core 檢查(Phase 3 實作時加 DB trigger 評估) |
| 分類/來源/狀態值合法 | Drizzle text enum + TypeScript 型別 |
| 影像只增不刪 | 慣例(conventions 第 5 節)—— 刪除 API 不碰檔案 |
