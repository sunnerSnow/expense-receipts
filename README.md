# expense-receipts — 公司報帳單據管理

拍照上傳發票/收據 → 自動辨識 → 分類 → 月結匯出給會計。自用工具,不商品化。

## 核心概念:辨識分兩層,AI 是最後手段

| 單據 | 辨識方式 | 成本 |
|---|---|---|
| 電子發票證明聯 | 客戶端解析 QR code(`packages/core` 的 `parseEInvoiceQr`) | 免費、100% 準確,直接入帳 |
| 手開發票、收銀機發票、收據、國外單據 | Gemini vision + structured output(`apps/worker`) | flash 模型有免費額度,結果進「待確認」 |

電子發票證明聯左側 QR code 內含發票號碼、日期、金額、買賣方統編與品項,
解出來就是結構化資料,不需要任何 AI。

## 快速開始

需求:Node.js 22+、pnpm 10、Docker(跑 PostgreSQL)。

```bash
pnpm install
cp .env.example .env          # 填入實際值:COMPANY_TAX_ID、GEMINI_API_KEY
docker compose up -d          # PostgreSQL 17,host port 5433(避開 booking-crm 的 5432)
pnpm db:migrate               # 套用 migrations
pnpm db:seed                  # 預設分類 + admin 使用者
pnpm dev                      # Next.js dev server(http://localhost:3000)
pnpm worker                   # 背景工作程序(另開終端;AI 辨識要靠它)
```

## 常用指令

```bash
pnpm dev          # Next.js dev server
pnpm worker       # pg-boss 背景工作程序(AI 辨識靠它)
pnpm check:ai     # 檢查 Gemini 金鑰與模型是否可用(不必上傳單據)
pnpm typecheck    # 全 workspace 型別檢查
pnpm test         # 全 workspace 測試(vitest)
pnpm db:generate  # schema 變更 → 產生 migration(產出的 SQL 要人工 review)
pnpm db:migrate   # 套用 migrations
pnpm db:seed      # 寫入預設分類與 admin 使用者
pnpm db:studio    # Drizzle Studio 瀏覽資料
```

## 架構

```
apps/web          Next.js 15 PWA:拍照上傳、QR 解析(客戶端)、待確認、分類、報表
apps/worker       pg-boss:AI 辨識(src/recognizer 是供應商 adapter)、匯出檔產生(Phase 3)
packages/core     業務邏輯(純函式,禁止 IO):QR 解析、扣抵判斷、狀態機、
                  AI 辨識的提示詞/輸出 schema/結果驗證、預設分類
packages/db       Drizzle schema + migrations + seed
packages/config   zod 環境變數驗證(parseEnv)+ 路徑解析
packages/queue    佇列名稱與 payload 型別(web 與 worker 的共用契約)
```

依賴方向:apps → core / db / config / queue。core 不依賴任何東西,db 與 core
互不依賴,apps 之間不互相 import。

## 資料流

```
拍照 ──▶ 客戶端 jsQR 解碼
          ├─ 解到電子發票 QR ──▶ parseEInvoiceQr ──▶ 直接入帳(confirmed)
          └─ 解不到 ──▶ 上傳影像 ──▶ pg-boss ──▶ worker 送 Gemini 辨識
                                        └──▶ 待確認(pending_review)+ 核對提示
                                                 ──人工核對──▶ confirmed
月結 ──▶ 選期間 ──▶ 匯出 CSV/Excel + 影像打包(Phase 3)──▶ 單據標記 exported(終態)
```

單據狀態機:`pending_review → confirmed → exported`,單向不可回頭。

## Roadmap(摘要)

- **Phase 0 — 骨架** ✅:monorepo、schema、QR 解析器、制度文件
- **Phase 1 — 可日常使用** ✅:拍照上傳、QR 解析入帳、手動分類、單據列表與月統計
- **Phase 2 — AI 辨識** ✅:Gemini 辨識非電子發票單據、統編比對、分類建議、待確認流程
- **Phase 3 — 月結匯出**:CSV/Excel + 影像打包、匯出批次鎖定
- **擱置**:個人記帳模式、載具同步(財政部 API 僅限公司申請,已決定不走)、簽核流程

完整版見 [docs/roadmap.md](docs/roadmap.md)。

## 文件

| 文件 | 內容 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | AI Agent 工作規範與鐵律 |
| [docs/roadmap.md](docs/roadmap.md) | 各 Phase 範圍與刻意不做的事 |
| [docs/domain-model.md](docs/domain-model.md) | 資料模型與不變量 |
| [docs/conventions.md](docs/conventions.md) | 程式碼慣例與紅線 |
| [docs/adr/](docs/adr/README.md) | 架構決策紀錄(為什麼這樣設計) |
| [docs/engineering-playbook.md](docs/engineering-playbook.md) | 可移植的工程制度(承襲自 booking-crm) |
