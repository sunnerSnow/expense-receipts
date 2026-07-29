# Conventions(現行規則)

ADR 記歷史,這裡記「現在怎麼寫」。慣例成形時更新。

## 1. 分層

- 業務邏輯(判斷、轉換、計算)寫在 `packages/core`,一律純函式 + 單元測試
- `apps/web` 的 route handler / server action 只做:取資料 → 呼叫 core → 寫資料
- `apps/worker` 同理:收 job → 取資料 → 呼叫 core(與外部 API)→ 寫資料
- 佇列名稱只用 `apps/worker/src/index.ts` 的 `QUEUES` 常數,不散落字串

## 2. 環境變數

- 禁止裸 `process.env.X`;一律經 `@expense-receipts/config` 的 `parseEnv`
- 各 app 定義自己的 env schema(web 在 `lib/env.ts`、worker 在 `src/env.ts`)
- 新增變數時同步更新 `.env.example`(含註解說明用途與哪個 Phase 需要)

## 3. 資料庫變更四步

1. 改 `packages/db/src/schema/index.ts`
2. `pnpm db:generate` 產生 migration
3. **人工 review 產出的 SQL**(尤其索引與約束)
4. `pnpm db:migrate` 套用;已套用的 migration 不可再改

## 4. core 與 db 的 enum 同步

db 不 import core(保持互不依賴、migration 工具不用跑 core 的程式碼)。
`doc_type` / `source` / `status` / `deductibility` 的值在兩邊手動同步:

- 唯一真相源:`packages/core/src/receipt.ts` 的 const 陣列
- 改值時必須同步改 `packages/db/src/schema/index.ts` 對應欄位的 enum,並出 migration

## 5. 單據影像

- 存 `UPLOAD_DIR`(預設 `./uploads`,已 gitignore),檔名用 receipt id
- 影像是報帳憑證:任何刪除操作只刪資料列,不刪檔案
- 影像不進 git、不進 log

## 6. 金額

- DB 用 `numeric(12,2)`(drizzle 讀出來是 string),台幣單據實務上是整數
- 金額運算在 core 做,以「分」為單位的整數運算或字串比對,避免浮點誤差
- QR 解析出的 `salesAmount` / `totalAmount` 是新台幣整數(16 進位轉換而來)

## 7. 測試

- core 的公開函式必有 vitest 單元測試,測試檔與原始碼同目錄(`*.test.ts`)
- 跑 `pnpm test` = 全 workspace;目前只有 core 有測試腳本
