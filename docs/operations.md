# 日常維運:開機自動上線 + 手機從外面連

這套系統是**自用工具、要用才開電腦**的模式,不是 24 小時服務。這份文件講怎麼
讓「開機 → 直接能用」,以及手機在外面(4G)怎麼連得到。

## 使用節奏

```
出差中     用手機相機拍收據 → 存在相簿裡(電腦關著,傳不了)
回辦公室   開電腦 → 開網頁 → 一批照片一起上傳 → AI 辨識 → 核對
月底       開電腦 → 匯出 → 交給會計 → 關機
```

**電腦關著的時候手機上傳不了** —— 這是這個模式的代價,不是 bug。要遠端喚醒得
在辦公室放一台一直開著的機器(能發 Wake-on-LAN 的路由器或 Raspberry Pi),
自用規模不值得。

## 三個程序

| 程序 | 誰負責啟動 | 說明 |
|---|---|---|
| PostgreSQL | Docker Desktop | `docker-compose.yml` 設了 `restart: unless-stopped`,Docker 一啟動就帶起來 |
| 網頁 | 工作排程 `expense-receipts-web` | `pnpm start:web`(production build) |
| 背景工作 | 工作排程 `expense-receipts-worker` | `pnpm start:worker`(AI 辨識、月結匯出) |

啟動順序不用管:**worker 會自己等資料庫**(最多兩分鐘),網頁在資料庫還沒好時
也只是個別請求失敗,不會整個掛掉。

## 一次性設定

### 1. Docker Desktop 開機自動啟動

Docker Desktop → Settings → General → 勾選 **Start Docker Desktop when you sign in**。

然後讓新的 restart 政策生效(只需做一次):

```powershell
docker compose up -d
```

### 2. 建 production build

`pnpm dev` 是開發模式:慢、會自己重新編譯、不適合當日常工具。日常用的是
production build:

```powershell
pnpm build
```

**每次程式碼有更新都要重跑一次** —— 沒重建的話跑的還是舊版。

### 3. 註冊開機自動啟動

```powershell
pwsh -File scripts\install-autostart.ps1
```

不需要系統管理員權限(工作以你自己的身分執行)。註冊完可以立刻測試:

```powershell
Start-ScheduledTask -TaskName expense-receipts-web
Start-ScheduledTask -TaskName expense-receipts-worker
Get-ScheduledTask -TaskName expense-receipts-*
```

要移除:`pwsh -File scripts\install-autostart.ps1 -Remove`

兩個工作都設成:視窗隱藏、沒有執行時間上限、失敗後每分鐘重試三次、
用電池時照跑、登入後延遲 30 秒(讓 Docker Desktop 先就緒)。

**觸發條件是「登入時」而不是「開機時」** —— 因為 Docker Desktop 本來就需要
使用者登入才會啟動。所以流程是:開機 → 登入 → 三十秒後全部就緒。

### 4. 電源設定

使用中不要讓電腦睡著,睡著等於手機那邊直接斷線:

```
設定 → 系統 → 電源 → 螢幕與睡眠 → 「插電時,讓裝置進入睡眠」設為「永不」
```

螢幕關掉沒關係,**睡眠才會斷**。

### 5. Tailscale(手機從外面連)

Tailscale 建一個只有你們裝置在裡面的私人網路:不用網域、不用開任何 port、
不用管 IP 變動,而且自動有 HTTPS 憑證。

1. 電腦裝 Tailscale 並登入(它會註冊成 Windows 服務,之後自動啟動)
2. 手機也裝 Tailscale,登入**同一個帳號**
3. 在電腦上把網頁掛到 Tailscale:

```powershell
tailscale serve --bg 3000
```

4. 查網址:

```powershell
tailscale serve status
```

會得到類似 `https://你的電腦名.你的tailnet.ts.net` 的固定網址。手機不管在
哪個網路都能開,iOS Safari 可以「分享 → 加入主畫面」當 App 用。

要給別人用:Tailscale 後台邀請對方加入你的 tailnet,對方裝 app 登入即可。

**安全性上的意義**:登入頁不在公網上,外面的人連連到都連不到。這也是為什麼
「登入嘗試次數限制」目前還不是上線的阻擋條件 —— 真要對公網開放時再補。

`pnpm url`(區域網路 IP)在同一個 Wi-Fi 底下仍然可用,但有了 Tailscale 之後
基本上用不到了。

## 要改程式的時候:先停掉排程

自動啟動的網頁佔用 **port 3000**,跟 `pnpm dev` 是同一個 —— 不停掉的話
`pnpm dev` 會因為連接埠被佔用而起不來(而且症狀看起來像是「dev 壞了」)。

```powershell
Stop-ScheduledTask -TaskName expense-receipts-web
Stop-ScheduledTask -TaskName expense-receipts-worker
# 改完、pnpm build 之後再啟動回來
Start-ScheduledTask -TaskName expense-receipts-web
Start-ScheduledTask -TaskName expense-receipts-worker
```

同理:**不要對著正在執行的 `next dev` 所用的 `.next` 跑 `pnpm build`** ——
那個 dev server 會找不到自己的 chunk,頁面出得來但 JS 全部 404、React 不會
hydrate,症狀是「按鈕點不動」。要並行驗證請用 `NEXT_DIST_DIR=.next-verify`
搭配另一個 port(見 conventions 7c)。

## 例行事項

### 更新程式之後

```powershell
pnpm install          # 相依套件有變才需要
pnpm db:migrate       # schema 有變才需要
pnpm build            # 一定要
Restart-ScheduledTask -TaskName expense-receipts-web
Restart-ScheduledTask -TaskName expense-receipts-worker
```

### 關機

用**正常關機**,不要直接拔電源或長按電源鍵 —— 讓 PostgreSQL 有機會收尾。

### 備份(還沒自動化)

要保的三樣東西,總量很小(實測平均一張影像 352 KB,五年累積約 2 GB):

| 內容 | 位置 |
|---|---|
| 資料庫 | Docker volume `expense-receipts_pgdata` |
| 單據影像 | `uploads/` |
| 匯出檔 | `exports/` |

資料庫備份:

```powershell
docker compose exec -T db pg_dump -U app expense_receipts > backup.sql
```

## 疑難排解

| 症狀 | 先看這裡 |
|---|---|
| 網頁開不起來 | `Get-ScheduledTaskInfo -TaskName expense-receipts-web` 看 LastTaskResult;沒跑 `pnpm build` 是最常見原因 |
| 上傳後一直「辨識中」 | worker 沒起來。worker 啟動時會自動救回卡住的單據,先重啟它 |
| 手機連不到 | 電腦是不是睡著了 / Tailscale 是不是斷了(`tailscale status`) |
| 資料庫連不上 | Docker Desktop 有沒有啟動(`docker compose ps`) |

## 換機器 / 換路徑

**專案放哪都可以** —— 資料庫裡的檔案位置會在讀取時正規化成目前的
`UPLOAD_DIR` / `EXPORT_DIR`(見 [ADR-0007](adr/0007-storage-relative-paths.md))。
早期資料存的是舊機器的絕對路徑,一樣讀得到,不需要改資料庫。

搬機器要帶走的四樣東西:

| 內容 | 位置 |
|---|---|
| 程式碼 | GitHub(clone 就好) |
| `.env` | **不在 git 裡,只有本機一份** |
| 資料庫 | `docker compose exec -T db sh -c "pg_dump -U app expense_receipts > /tmp/db.sql"` 再 `docker cp` 出來 |
| `uploads/` 與 `exports/` | 直接複製 |

還原後跑 `pnpm install` → `pnpm build` → `install-autostart.ps1`,不要跑
`pnpm db:seed`(dump 裡已經有使用者與分類)。
