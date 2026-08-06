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
  注入(pnpm --filter 會把 cwd 換成 package 目錄,Next/tsx 不會自己往上找)。
  **`build` 也要包** —— `next build` 的 collect page data 階段會真的執行
  server 模組,少了環境變數會在這一步失敗(踩過一次)
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

## 4c. 認證

- 密碼雜湊只用 `packages/auth`(Node 內建 scrypt);**不要放進 `packages/core`**
  —— core 會被瀏覽器端 bundle,import `node:crypto` 會編譯失敗
- 密碼規則走 core 的 `validatePassword`,web 表單與 CLI 共用同一套判斷
- 登入失敗一律回同一句話,且帳號不存在時也要跑 `burnPasswordTime`
  (否則回應時間會洩漏帳號是否存在)
- 新增使用者或重設密碼:網頁 `/users`(僅管理者);開機情境用
  `pnpm user:password -- --email x`,密碼用 `NEW_PASSWORD` 環境變數傳
  (引數會留在 shell 歷史)
- **權限檢查每個 server action 都要自己做一次**(`requireAdmin()`),不能只靠頁面擋
  —— server action 是可以被直接呼叫的端點,「畫面上沒有按鈕」不等於「不能被觸發」
- 產生的密碼只在該次回應顯示一次,不存明碼、不寫 log

## 5. 單據影像

- 存 `UPLOAD_DIR`(預設 `./uploads`,已 gitignore),檔名用 receipt id
- 影像是報帳憑證:任何刪除操作只刪資料列,不刪檔案
- 影像不進 git、不進 log
- 月結匯出產出物存 `EXPORT_DIR`(已 gitignore),路徑記在 `export_batches`
- **已知債:`image_path` 與 `export_batches.file_path` 存的是絕對路徑**
  (`C:\Users\...\uploads\x.jpg`)。儲存位置一換(容器、VPS、物件儲存)舊資料
  就讀不到。要改成相對於 `UPLOAD_DIR` / `EXPORT_DIR`,但 `export_batches`
  受鐵律 5 保護不能改既有列 —— 動之前先寫 ADR 決定相容策略

## 6. 金額

- DB 用 `numeric(12,2)`(drizzle 讀出來是 string),台幣單據實務上是整數
- 金額運算在 core 做,以「分」為單位的整數運算或字串比對,避免浮點誤差
- QR 解析出的 `salesAmount` / `totalAmount` 是新台幣整數(16 進位轉換而來)

## 7. 測試

- core 的公開函式必有 vitest 單元測試,測試檔與原始碼同目錄(`*.test.ts`)
- 跑 `pnpm test` = 全 workspace;目前只有 core 有測試腳本
- **`pnpm build` 綠不代表 `pnpm dev` 能跑**:dev 會多編一份 edge runtime 的
  `instrumentation`,production build 不會。動到 `lib/env.ts`、`instrumentation.ts`
  或 `packages/config` 時,一定要真的起一次 `pnpm dev` 並開 `/login` 確認 200

## 6a. 樣式

- **不寫內嵌 `style={{...}}`**。所有樣式走 `apps/web/app/globals.css` 的 token 與
  元件 class(`.card` / `.btn` / `.field` / `.chip` / `.banner` / `.item` …)
- 顏色、圓角、陰影只用 CSS 變數,不寫死色碼 —— 深色主題靠 token 覆寫,
  元件本身不進 media query
- 語意色(綠/琥珀/紅)與品牌色分開:狀態不是裝飾,`STATUS_CHIP` 之類的對應表
  放 `lib/labels.ts`
- 金額、統編、日期加 `.tnum`(等寬數字),欄位才對得齊
- 新增元件 class 時注意串接權重:`.field > span` 這種型別選擇器(0,1,1)會蓋掉
  `.field-hint`(0,1,0),已踩過一次
- 主要動作用 `.actions-bar` 吸底:手機上影像 + 十幾個欄位會把按鈕推到螢幕外
- **多欄排版一律 `minmax(0, 1fr)`,不要寫 `1fr`**:`1fr` 的下限是 min-content,
  軌道會被裡面的元素撐開而超出卡片。表單控件也要 `min-width: 0`
- **`input[type=date]` 要自己壓平**:原生 chrome 的 min-content 寬度(日期文字 +
  日曆圖示)比半格寬,內部行高又比一般文字高 —— 放進 `.grid-2` 會橫向溢出、
  而且比隔壁的 select 高一截(實測 48.8px vs 44px)。作法是
  `appearance: none` + 固定 `height` + `display: flex; align-items: center`
  (固定高度才鎖得住,flex 是為了讓值仍垂直居中)

## 6b. 期間篩選的預設值

以月份篩選的頁面(單據列表、月結匯出)不要硬性預設「當月」。報帳是事後行為,
當月往下常常一筆都沒有,畫面看起來就像資料遺失或功能壞掉。規則:

- 當月有資料 → 用當月;否則退到最近一個有資料的月份,並明確告知已自動切換
- 一併列出所有有資料的月份(附筆數)當快速連結,讓「東西在哪」一眼可見

## 7b. 客戶端的重運算

- 會吃掉主執行緒的同步運算(影像處理、解碼)一律放 Web Worker,不放元件裡。
  jsQR 掃一張手機照片(1200 萬像素)要好幾秒,跑在主執行緒上畫面會整個凍住 ——
  使用者看到的是「按鈕點不動」,而不是「正在處理」
- 處理影像前先縮到夠用的尺寸(QR 偵測每個模組 2~3 像素就夠,不需要原解析度)
- 建不出 worker 時要有退路(直接走伺服器端辨識),不要 fallback 回主執行緒硬算
- 任何等待都要有逾時上限,並且不要讓送出按鈕永遠停在 disabled

## 7c. 不要在 dev server 執行中動它的 .next

對著正在執行的 `next dev` 所用的 `.next` 目錄跑 `pnpm build`、或把它砍掉,會讓
那個 dev server 再也找不到自己的 chunk:**頁面 HTML 還出得來,但所有 JS 變成
`ERR_ABORTED`、React 不會 hydrate**。表面症狀是「按鈕點不動、選了檔案沒反應」,
完全聯想不到根因,曾因此浪費一輪除錯。

要在別人開發中並行驗證時:

```bash
NEXT_DIST_DIR=.next-verify npx next dev -p 3005   # 用另一個輸出目錄與 port
```

`distDir` 已可用 `NEXT_DIST_DIR` 覆寫(見 apps/web/next.config.ts)。

## 7d. 前端行為要在真實瀏覽器裡驗

`pnpm build` 綠、頁面回 200,都不代表前端真的能動 —— hydration 失敗時兩者都是綠的。
本機沒有瀏覽器自動化套件時,可以用系統 Chrome 的 CDP 直接驗(不必加任何依賴):

```bash
chrome --headless=new --remote-debugging-port=9222 about:blank
# 再用 Node 內建的 fetch + WebSocket 對 CDP 下 Runtime.evaluate
```

至少要驗:目標元素有 `__react*` 屬性(代表已 hydrate)、`Network.loadingFailed`
沒有 script/stylesheet、以及互動後畫面真的變了。

## 7e. Windows 指令稿

- **含非 ASCII 字元的 `.ps1` 必須存成 UTF-8 with BOM**。Windows PowerShell 5.1
  沒有 BOM 就當 ANSI 讀,中文註解會變亂碼、破折號與引號被當成語法字元 ——
  整個檔案解析失敗,錯誤訊息還指向不相干的行。踩過一次
- 自動啟動用工作排程(登入時觸發,不是開機時):Docker Desktop 本來就要
  使用者登入才會啟動,用開機觸發只會比資料庫早太多

## 8. Node 專屬 API 與 edge runtime

- Next 會把 `instrumentation.ts` 同時編成 nodejs 與 edge 兩份。任何會牽連到
  `node:fs` / `node:path` 之類模組的 import,都要用編譯期常數擋住:
  `if (process.env.NEXT_RUNTIME === "nodejs") { await import("./lib/env"); }`
- `packages/config` 的 `index.ts` 會被 web 端 import,新增依賴 Node API 的東西時
  要意識到它會被拉進 web 的編譯圖(`resolveFromRepoRoot` 就是這個情況)
