# expense-receipts — AI Agent 工作規範

公司報帳單據管理(自用,不商品化):拍照上傳 → 辨識(QR 優先/AI 補位)→ 分類 → 月結匯出。

## 架構地圖

```
apps/web        Next.js 15 PWA:頁面 + route handlers(只做 IO 與組裝)
apps/worker     pg-boss:AI 辨識(Phase 2)、匯出產生(Phase 3)
packages/core   業務邏輯(純函式,禁止 import 任何 IO)—— QR 解析、扣抵判斷、狀態機
packages/db     Drizzle schema + migrations + seed
packages/config zod 環境變數驗證(parseEnv)—— 各 app 定義自己的 env schema
```

依賴方向:apps → core / db / config。core 不依賴任何東西;db 與 core 互不依賴
(共用 enum 手動同步,見 conventions 第 4 節)。

## 鐵律(違反 = 資料正確性或憑證合規事故,任何情況不可違反)

1. 業務邏輯只寫在 `packages/core`;apps 層只做取資料→呼叫 core→寫資料
2. 單據狀態一律走 core 的 `canTransitionStatus()`;`pending_review → confirmed → exported`
   單向不可回頭,禁止直接 `UPDATE receipts.status` 跳關
3. AI 辨識(source='ai')的單據一律落在 `pending_review`,不得直接 confirmed;
   QR 解析(source='qr')可直接 confirmed
4. `receipts_invoice_number_unique` 部分唯一索引(發票號碼去重)不可移除
5. 已匯出(exported)的單據不可修改、不可刪除;`export_batches` 只允許 INSERT
6. 單據影像是報帳憑證:只增不刪,刪除單據紀錄也要保留影像檔
7. 已套用的 migration 不可修改
8. 密鑰(ANTHROPIC_API_KEY 等)只從環境變數讀,不得寫死、不得出現在 log

## 修改架構前必讀

- 動到資料模型 → [docs/domain-model.md](docs/domain-model.md) + 相關 ADR
- 違反現行 ADR 的修改:先寫新 ADR 取代舊的(用 `/new-adr`),再動程式碼
- 功能不在 [docs/roadmap.md](docs/roadmap.md) 當前 Phase 內 → 先跟使用者確認,不要順手做

## 常用指令

```bash
pnpm dev          # Next.js dev server
pnpm worker       # 背景工作程序
pnpm typecheck    # 全 workspace 型別檢查
pnpm test         # 全 workspace 測試(vitest)
pnpm db:generate  # schema 變更 → 產生 migration(產出的 SQL 要人工 review)
pnpm db:migrate   # 套用 migrations
pnpm db:studio    # Drizzle Studio 瀏覽資料
```

## 完成定義(DoD)

- `pnpm typecheck` 與 `pnpm test` 全綠
- `packages/core` 新增的公開函式有單元測試
- 做了新的架構判斷 → 已寫入 ADR;新慣例 → 已寫入 docs/conventions.md
