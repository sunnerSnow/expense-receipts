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
cp .env.example .env          # 填入 GEMINI_API_KEY(COMPANY_TAX_ID 選填)
docker compose up -d          # PostgreSQL 17,host port 5433(避開 booking-crm 的 5432)
pnpm db:migrate               # 套用 migrations
pnpm db:seed                  # 預設分類 + admin 使用者(會印出開發用密碼)
pnpm dev                      # Next.js dev server(http://localhost:3000)
pnpm worker                   # 背景工作程序(另開終端;AI 辨識要靠它)
pnpm url                      # 手機要連的話,用這個查網址
```

### 帳號與密碼

登入需要 email + 密碼(scrypt 雜湊,見 [ADR-0006](docs/adr/0006-password-auth.md))。
`password_hash` 為 NULL 的帳號**不能登入** —— 這是安全預設值,不是後門。

有了第一個管理者帳號之後,**日常增減使用者請用網頁**:登入後導覽列的「使用者」
(僅管理者可見)可以新增帳號、重設密碼、切換權限,產生的密碼會顯示一次讓你轉達。

下面的 CLI 留給「還沒有任何管理者帳號」的開機情境:

```bash
# 建立帳號(密碼用環境變數傳,不會留在 shell 歷史)
NEW_PASSWORD='一句夠長的密碼' pnpm user:password -- --email you@company.com --name 你的名字 --role admin

# 不給 NEW_PASSWORD 就會隨機產生一組並印出來(只印一次)
pnpm user:password -- --email member@company.com
```

使用者自己改密碼在 `/account`。沒有「忘記密碼」寄信重設 —— 沒有寄信管道,
管理者用上面的指令重設更直接。

### 用手機操作

拍照上傳是手機情境,所以要從手機連到這台電腦。

**同一個 Wi-Fi**(開發時最快):

1. `pnpm url` 取得網址(例如 `http://192.168.0.188:3000`)
2. 手機瀏覽器開它,用已註冊的 email 登入

**IP 會變**:DHCP 每次分配的位址可能不同,連不上就重跑 `pnpm url`。
`next dev` 自己印的 Network 網址在有 WSL / Docker 虛擬網卡的機器上常是連不到的
`172.x` 位址,所以用 `pnpm url` 而不是照抄它。

**從外面連(4G、出差)**:用 Tailscale,不需要網域也不用開任何 port,
而且網址固定、自動有 HTTPS。設定步驟見
[docs/operations.md](docs/operations.md#4-tailscale手機從外面連)。

**電腦沒開的時候**:用「離線拍收據」(`/receipts/new/offline`)—— 照片與備註
先存在手機裡,等連得到伺服器、打開 App 就自動補送並進 AI 辨識(ADR-0008)。
**出發前記得先在線上開一次那一頁**,service worker 才裝得起來。

### 當日常工具用(整套跑在 Docker)

`pnpm dev` 是開發模式。日常使用跑容器 —— 三個服務(資料庫、網頁、背景工作)
都設了 `restart: unless-stopped`,**Docker Desktop 一啟動就全部上線**:

```powershell
docker compose up -d
```

換機器或全新安裝**只要 Docker 與 Git**,不需要 Node、pnpm 或 build。
建表與建帳號用一次性的 `tools` 容器:

```powershell
docker compose run --rm tools pnpm migrate   # 建表
docker compose run --rm tools pnpm seed      # 預設分類
docker compose run --rm -e NEW_PASSWORD='...' tools pnpm user:password -- --email you@company.com --role admin
```

完整說明見 [docs/operations.md](docs/operations.md)。

## 常用指令

```bash
pnpm dev          # Next.js dev server(開發用)
pnpm worker       # pg-boss 背景工作程序(開發用;AI 辨識靠它)
pnpm build        # production build(只有不用 Docker 直接跑在宿主時才需要)
pnpm start:web    # production 網頁伺服器(同上)
pnpm start:worker # production 背景工作程序(同上)
pnpm url          # 印出手機可連的網址(DHCP 換 IP 後就跑這個)
pnpm user:password # 建立帳號或重設密碼(見下方)
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
apps/web          Next.js 15 PWA:拍照上傳、QR 解析(客戶端)、待確認、分類、報表、月結匯出
apps/worker       pg-boss:AI 辨識(src/recognizer 是供應商 adapter)、匯出檔產生(Phase 3)
packages/core     業務邏輯(純函式,禁止 IO):QR 解析、扣抵判斷、狀態機、
                  AI 辨識的提示詞/輸出 schema/結果驗證、預設分類
packages/db       Drizzle schema + migrations + seed
packages/config   zod 環境變數驗證(parseEnv)+ 路徑解析
packages/queue    佇列名稱與 payload 型別(web 與 worker 的共用契約)
packages/auth     密碼雜湊與隨機密碼產生(scrypt;只有 node 端會用)
```

依賴方向:apps → core / db / config / queue / auth。core 不依賴任何東西,
db 與 core 互不依賴,apps 之間不互相 import。

## 資料流

```
拍照 ──▶ 客戶端 jsQR 解碼
          ├─ 解到電子發票 QR ──▶ parseEInvoiceQr ──▶ 直接入帳(confirmed)
          └─ 解不到 ──▶ 上傳影像 ──▶ pg-boss ──▶ worker 送 Gemini 辨識
                                        └──▶ 待確認(pending_review)+ 核對提示
                                                 ──人工核對──▶ confirmed
月結 ──▶ 選月份 ──▶ worker 產 CSV 清單 + 憑證影像 zip ──▶ 單據標記 exported(終態)
```

單據狀態機:`pending_review → confirmed → exported`,單向不可回頭。

## Roadmap(摘要)

- **Phase 0 — 骨架** ✅:monorepo、schema、QR 解析器、制度文件
- **Phase 1 — 可日常使用** ✅:拍照上傳、QR 解析入帳、手動分類、單據列表與月統計
- **Phase 2 — AI 辨識** ✅:Gemini 辨識非電子發票單據、統編比對、分類建議、待確認流程
- **Phase 3 — 月結匯出** ✅:CSV 清單 + 影像 zip、各幣別小計、匯出批次鎖定
- **擱置**:個人記帳模式、載具同步(財政部 API 僅限公司申請,已決定不走)、簽核流程

完整版見 [docs/roadmap.md](docs/roadmap.md)。

## 文件

| 文件 | 內容 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | AI Agent 工作規範與鐵律 |
| [docs/operations.md](docs/operations.md) | 開機自動上線、Tailscale、備份、疑難排解 |
| [docs/roadmap.md](docs/roadmap.md) | 各 Phase 範圍與刻意不做的事 |
| [docs/domain-model.md](docs/domain-model.md) | 資料模型與不變量 |
| [docs/conventions.md](docs/conventions.md) | 程式碼慣例與紅線 |
| [docs/adr/](docs/adr/README.md) | 架構決策紀錄(為什麼這樣設計) |
| [docs/engineering-playbook.md](docs/engineering-playbook.md) | 可移植的工程制度(承襲自 booking-crm) |
