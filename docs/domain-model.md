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
| `source` | qr(QR 解析)/ ai(雲端 vision 辨識)/ manual(手動 key) |
| `status` | pending_review → confirmed → exported(單向) |
| `invoice_number` | 發票號碼;部分唯一索引做去重(NULL 不受限,收據可無號碼) |
| `amount` / `tax_amount` | 含稅總額 / 稅額,numeric(12,2);**國外單據存原幣**,幣別看 currency |
| `deductibility` | deductible / expense_only / review,由 core 的 assessDeductibility 判定 |
| `image_path` | 憑證影像;只增不刪 |
| `raw_data` | 辨識原始資料(QR 原文,或 AI 的供應商/模型/token 用量/回傳 JSON),追溯用 |
| `recognition_status` | none / queued / succeeded / failed —— AI 工作生命週期,與 `status` 分離 |
| `recognition_error` | 辨識失敗原因(給人看的訊息) |
| `recognition_warnings` | 需人工核對的提示清單,由 core 的 `normalizeRecognition` 產出 |

### export_batches

一次月結匯出一列。**只允許 INSERT**(鐵律 5)—— 因此流程是「先產檔 → 再插入帶
路徑的批次紀錄」,不是「先建空批次 → 事後 UPDATE 補路徑」。

| 欄位 | 意義 |
|---|---|
| `period_year` / `period_month` | 匯出的月份 |
| `file_path` | CSV 清單路徑 |
| `image_zip_path` | 憑證影像 zip 路徑(該批完全沒有影像時為 NULL) |
| `receipt_count` | 這批單據筆數 |
| `currency_totals` | 各幣別小計,如 `{"TWD":"1373.00","THB":"547.00"}`;不換算 |

被匯出的單據回填 `export_batch_id` 並轉 exported。批次 INSERT 與單據狀態轉換
在**同一交易**內,不會出現「單據已匯出但查不到批次」或反之。

## 狀態機

```
pending_review ──確認──▶ confirmed ──月結匯出──▶ exported(終態)
```

- 轉換規則的唯一出口:`packages/core` 的 `canTransitionStatus()`
- source='qr' 建立時直接 confirmed(QR 資料 100% 準確)
- source='manual' 建立時直接 confirmed(上傳者當場輸入即已核對,自用免二次確認)
- source='ai' 一律從 pending_review 開始,必經人工確認才 confirmed

### AI 辨識流程(source='ai')

`status` 與 `recognition_status` 是兩條獨立的軸:前者是帳務生命週期,後者是辨識
工作的進度。worker 只寫後者與欄位內容,永遠不碰前者。

```
上傳(web)  影像落地 + 建空殼單據(amount=0、invoice_date=NULL)
            status=pending_review、recognition_status=queued  ──send──▶ pg-boss
worker      讀影像 → Gemini → core normalizeRecognition
            成功:回填欄位 + recognition_status=succeeded(+ warnings)
            失敗:recognition_status=failed + recognition_error
人工        核對 warning 清單 → 修正 → 確認入帳(confirmed)
```

確認入帳的前置條件(`confirmReceipt`):非 queued、有日期、金額不為 0 ——
缺日期的單據會落在所有月份區間之外,連月結都撈不到,不可入帳。

## 多幣別(海外出差)

`amount` 存**單據上的原幣金額**,不換算。因此:

- `summarizeReceipts()` 依 currency 分組:台幣總額(`totalCents`)與分類小計
  **只含台幣**,外幣走 `byCurrency` 另外列出。340 泰銖不能當 340 台幣加總。
- `deductibility` 對國外單據一律 `expense_only`(國外消費無台灣進項稅可扣抵)。
- 台灣專屬的欄位驗證(8 碼統編、2 字母+8 數字發票號碼、5% 營業稅比例)只在
  `currency === 'TWD'` 且 `doc_type !== 'foreign'` 時套用 —— 泰國 VAT 是 7%、
  統編 13 碼,硬套只會製造假警告。
- **匯率換算目前不做**:辨識時會加一條 warning 提醒需自行換算。要在報表/匯出
  自動換算需先決定匯率來源(實際刷卡金額 / 月平均匯率 / 會計指定),見 roadmap。

## 不變量(依執行強度排序,見 engineering-playbook 第二節)

| 不變量 | 下沉層級 |
|---|---|
| 發票號碼不重複入帳 | DB 部分唯一索引 `receipts_invoice_number_unique` |
| 狀態不跳關、不回頭 | core `canTransitionStatus()` + 單元測試 |
| exported 單據不可改 | core 檢查(Phase 3 實作時加 DB trigger 評估) |
| 分類/來源/狀態值合法 | Drizzle text enum + TypeScript 型別 |
| 影像只增不刪 | 慣例(conventions 第 5 節)—— 刪除 API 不碰檔案 |
| AI 結果不會直接入帳 | worker 的更新語句從不寫 `status`;確認動作另有前置檢查 |
| 外幣金額不被當台幣加總 | core `summarizeReceipts()` 依 currency 分組;台幣總額不含外幣 |
| 辨識中的單據不被人工覆寫 | server action 檢查 `recognition_status='queued'` 就拒絕編輯/確認 |
| 單據不被重複匯出 | 撈取條件 `status='confirmed' AND export_batch_id IS NULL` + 交易內再以 status 為條件更新 |
| 匯出批次與單據狀態一致 | 兩者同一交易;更新筆數不符即回滾整批 |
