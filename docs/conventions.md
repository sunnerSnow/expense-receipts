# Conventions(現行規則)

ADR 記歷史,這裡記「現在怎麼寫」。慣例成形時更新。

## 1. 分層

- 業務邏輯(判斷、轉換、計算)寫在 `packages/core`,一律純函式 + 單元測試
- `apps/web` 的 route handler / server action 只做:取資料 → 呼叫 core → 寫資料
- `apps/worker` 同理:收 job → 取資料 → 呼叫 core(與外部 API)→ 寫資料
- 佇列名稱與 payload 型別只用 `@expense-receipts/queue`(web send / worker work
  共用同一份契約;apps 之間不得互相 import)

## 1b. 外部 AI 供應商

- 供應商呼叫封在 `apps/worker/src/recognizer/`,實作 `ReceiptRecognizer` 介面;
  換供應商只改 `createRecognizer()`(見 ADR-0004)
- 提示詞、輸出 JSON Schema、回傳驗證一律在 `packages/core`(純函式 + 測試),
  不寫在 adapter 裡 —— 換供應商不該讓台灣單據的驗證規則跟著重寫
- 供應商錯誤只往外傳 `error.message`,不整包拋出(避免金鑰/影像進 log)
- 可重試(限流、逾時、5xx)與確定性失敗要分開:前者丟
  `TransientRecognitionError` 交給 pg-boss 退避重試,後者直接寫
  `recognition_status='failed'` 交人工

## 2. 環境變數

- 禁止裸 `process.env.X`;一律經 `@expense-receipts/config` 的 `parseEnv`
- 各 app 定義自己的 env schema(web 在 `lib/env.ts`、worker 在 `src/env.ts`)
- 新增變數時同步更新 `.env.example`(含註解說明用途與哪個 Phase 需要)
- `.env` 只有 monorepo 根目錄一份;root 的 npm scripts 用 `dotenv -e .env --`
  注入(pnpm --filter 會把 cwd 換成 package 目錄,Next/tsx 不會自己往上找)
- 路徑類變數(如 `UPLOAD_DIR`)用 `resolveFromRepoRoot()` 解析:web 與 worker
  的 cwd 不同,相對路徑會指到不同資料夾
- `COMPANY_TAX_ID` 是選填(留空 = 不做扣抵比對);env 層把空字串正規化成 `null`,
  下游只判斷一種「沒有值」
- 不要用 `z.string().default(...)`:在目前的 zod 版本經 `parseEnv` 後型別會變成
  `string | undefined`。要預設值就寫進 `.env.example`,schema 保持必填(fail fast)

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
- 同樣規則適用 `recognition_status`(`RECOGNITION_STATUSES`)

## 4b. 不可逆操作

- 會把資料推進終態的操作(目前只有月結匯出)一律走 worker + 資料庫交易,
  不在 server action 裡邊做邊回應
- 產出檔案先寫入磁碟,成功後才 INSERT 紀錄 —— 讓「紀錄存在」等於「檔案存在」
- 對外提供檔案下載時,路徑一律取自 DB 並驗證落在設定的目錄內(防路徑逃逸)
- UI 上要明確寫出「此操作不可逆」與影響筆數

## 5. 單據影像

- 存 `UPLOAD_DIR`(預設 `./uploads`,已 gitignore),檔名用 receipt id
- 影像是報帳憑證:任何刪除操作只刪資料列,不刪檔案
- 影像不進 git、不進 log
- 月結匯出產出物存 `EXPORT_DIR`(已 gitignore),路徑記在 `export_batches`

## 6. 金額

- DB 用 `numeric(12,2)`(drizzle 讀出來是 string),台幣單據實務上是整數
- 金額運算在 core 做,以「分」為單位的整數運算或字串比對,避免浮點誤差
- QR 解析出的 `salesAmount` / `totalAmount` 是新台幣整數(16 進位轉換而來)

## 7. 測試

- core 的公開函式必有 vitest 單元測試,測試檔與原始碼同目錄(`*.test.ts`)
- 跑 `pnpm test` = 全 workspace;目前只有 core 有測試腳本
