# 日常維運:開機自動上線 + 換機器 + 手機從外面連

這套系統是**自用工具、要用才開電腦**的模式,不是 24 小時服務。整套跑在 Docker 裡,
所以「裝在哪一台」不重要 —— 換機器只要三步驟。

## 使用節奏

```
出差中     用手機相機拍收據 → 存在相簿裡(電腦關著,傳不了)
回辦公室   開電腦 → 開網頁 → 一批照片一起上傳 → AI 辨識 → 核對
月底       開電腦 → 匯出 → 交給會計 → 關機
```

**電腦關著的時候手機上傳不了。** 這是這個模式的代價,不是 bug。真的要 24 小時,
就要把同一份 `docker-compose.yml` 搬到一台一直開著的機器(VPS / Railway / Render),
程式不用改。

## 三個容器

| 服務 | 內容 |
|---|---|
| `db` | PostgreSQL 17,資料在 Docker volume `pgdata` |
| `web` | Next.js(standalone 輸出),對外 port 3000 |
| `worker` | pg-boss:AI 辨識、月結匯出 |

三個都設了 `restart: unless-stopped`,**Docker Desktop 一啟動就全部帶起來**,
不必手動下指令。啟動順序也不用管:`web` / `worker` 都 `depends_on` 資料庫的
healthcheck,而且 worker 自己還會再等最多兩分鐘。

憑證影像與匯出檔掛在宿主的專案目錄:

```
./uploads  →  /data/uploads
./exports  →  /data/exports
```

容器砍掉重建都不會影響它們。

## 一次性設定

### 1. Docker Desktop 開機自動啟動

Settings → General → 勾 **Start Docker Desktop when you sign in**。

### 2. 起來

```powershell
docker compose up -d
```

第一次會建置映像(幾分鐘)。之後開機就自動起來,不用再下。

### 3. 電源設定

設定 → 系統 → 電源 → 插電時「永不」睡眠。睡著等於手機那邊直接斷線。
螢幕關掉沒關係,**睡眠才會斷**。

### 4. Tailscale(手機從外面連)

Tailscale 建一個只有你們裝置在裡面的私人網路:不用網域、不用開任何 port、
不用管 IP 變動,而且自動有 HTTPS。

1. 電腦裝 Tailscale 並登入(它會註冊成 Windows 服務,之後自動啟動)
2. 手機也裝 Tailscale,登入**同一個帳號**
3. 把網頁掛上去:

```powershell
tailscale serve --bg 3000
tailscale serve status
```

會得到 `https://你的電腦名.你的tailnet.ts.net` 這種固定網址。手機不管在哪個網路
都能開,iOS Safari 可以「分享 → 加入主畫面」當 App 用。

**安全性上的意義**:登入頁不在公網上,外面的人連連到都連不到。這也是為什麼
「登入嘗試次數限制」目前還不是上線的阻擋條件 —— 真要對公網開放時再補。

## 換機器(三步驟)

程式碼在 GitHub;要帶走的只有 `.env`、資料庫、`uploads/`、`exports/`。

### 舊機器:匯出資料庫

```powershell
docker compose exec -T db sh -c "pg_dump -U app expense_receipts > /tmp/db.sql"
docker cp expense-receipts-db:/tmp/db.sql .\db.sql
```

連同 `.env`、`uploads/`、`exports/` 一起複製到隨身碟或雲端硬碟。

> **為什麼不直接複製 Docker volume**:PostgreSQL 執行中的資料目錄是幾十個互相
> 依賴的檔案,複製到「時間對不齊」的狀態就壞了,而且要到新機器才會發現。
> `pg_dump` 是請資料庫自己產生一致快照,輸出成一個純文字檔,不會壞。

### 新機器:三步驟

```powershell
# 1. 程式碼(放哪個路徑都可以)
git clone https://github.com/sunnerSnow/expense-receipts.git
cd expense-receipts

# 2. 放回不在 git 裡的東西
Copy-Item <備份>\.env      . -Force
Copy-Item <備份>\uploads   . -Recurse -Force
Copy-Item <備份>\exports   . -Recurse -Force

# 3. 起來 + 灌資料
docker compose up -d
docker cp <備份>\db.sql expense-receipts-db:/tmp/db.sql
docker compose exec -T db psql -U app -d expense_receipts -f /tmp/db.sql
```

**不需要 Node、pnpm、`pnpm install`、`pnpm build`**,也不需要 Windows 工作排程。
Mac / Linux 也是同樣三步驟。

驗收:

```powershell
docker compose exec -T db psql -U app -d expense_receipts -c "select count(*) from receipts"
```

**不要跑 `pnpm db:seed`** —— dump 裡已經有使用者與分類。`pnpm db:migrate` 也不用,
dump 帶了 `drizzle.__drizzle_migrations`。

`.env` 裡的 `DATABASE_URL` 指向 `localhost:5433`,那是給宿主的工具用的
(`pnpm db:studio`、`psql`);容器之間走內部網路的 `db:5432`,由 compose 覆寫,
不用改。

## 要改程式的時候

容器跑的是建置好的映像,改了原始碼要重建才會生效:

```powershell
docker compose up -d --build
```

想用熱重載開發,先把容器停掉再跑 dev(否則兩邊搶 port 3000):

```powershell
docker compose stop web worker
pnpm dev
pnpm worker        # 另一個終端機
```

`docker compose stop` 之後 `unless-stopped` 不會把它們拉回來,要自己
`docker compose start web worker`。

> ⚠️ **不要對著正在執行的 `next dev` 所用的 `.next` 跑 `pnpm build`** ——
> 那個 dev server 會找不到自己的 chunk,頁面出得來但 JS 全部 404、React 不會
> hydrate,症狀是「按鈕點不動」。要並行驗證用 `NEXT_DIST_DIR=.next-verify`
> 搭配另一個 port(見 conventions 7c)。

## 例行事項

### 關機

用**正常關機**,不要直接拔電源或長按電源鍵 —— 讓 PostgreSQL 有機會收尾。

### 備份(還沒自動化)

要保的三樣東西,總量很小(實測平均一張影像 352 KB,五年累積約 2 GB):

| 內容 | 怎麼備 |
|---|---|
| 資料庫 | 上面的 `pg_dump` 指令 |
| `uploads/` | 直接複製(只增不刪的檔案,雲端硬碟同步也安全) |
| `exports/` | 同上 |

## 疑難排解

| 症狀 | 先看這裡 |
|---|---|
| 網頁開不起來 | `docker compose ps` 看狀態,`docker compose logs web --tail 50` |
| 上傳後一直「辨識中」 | `docker compose logs worker`。worker 啟動時會自動救回卡住的單據,先 `docker compose restart worker` |
| 手機連不到 | 電腦是不是睡著了 / `tailscale status` |
| 資料庫連不上 | Docker Desktop 有沒有啟動(`docker compose ps`) |
| 改了程式沒生效 | 忘了 `--build` |

## 舊的 Windows 工作排程(已淘汰)

容器化之前是用工作排程跑 `pnpm start:web` / `pnpm start:worker`。現在由 Docker
負責,**兩套不能並存 —— 會搶 port 3000**。如果之前註冊過,移除它:

```powershell
pwsh -File scripts\install-autostart.ps1 -Remove
```

`scripts\install-autostart.ps1` 與 `pnpm start:web` / `start:worker` 保留給
「不想用 Docker、想直接跑在 Windows 上」的情況。
