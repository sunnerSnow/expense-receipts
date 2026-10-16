# 日常維運:開機自動上線 + 換機器 + 手機從外面連

這套系統是**自用工具、要用才開電腦**的模式,不是 24 小時服務。整套跑在 Docker 裡,
所以「裝在哪一台」不重要 —— 換機器只要三步驟。

## 使用節奏

```
出差中     用「離線拍收據」拍照 + 寫備註 → 有網路就送到雲端中繼站,沒網路先存手機
回辦公室   開電腦 → worker 自動從中繼站拉回、AI 辨識 → 核對
月底       開電腦 → 匯出 → 交給會計 → 關機
```

沒設定雲端中繼站時,照片會存在手機裡,回辦公室要打開 App 才會補送(見下方離線拍收據)。

電腦關著時**照樣能建單**(見下方離線拍收據),只是要等回來才會真的送出去。
真的要 24 小時隨時可查,就把同一份 `docker-compose.yml` 搬到一台一直開著的
機器(VPS / Railway / Render),程式不用改。

## 離線拍收據(ADR-0008)

`/receipts/new/offline` 這一頁在**完全沒網路、或伺服器沒開**的時候也打得開:
拍照、寫備註、存進手機。等連得到伺服器、打開這個 App 就會自動補送並進 AI 辨識。

**出發前務必先在線上開一次這一頁** —— service worker 要先安裝與預先快取,
之後離線才打得開。開過一次之後就一直有效。

幾個要知道的事:

- **要打開 App 才會補送。** iOS Safari 不支援 Background Sync,關著 App 不會送。
  回辦公室打開 App(任何一頁)就會自動補送,畫面上方會有橫幅告訴你送了幾筆。
- **離線時不填金額日期** —— 那些交給 AI。備註才是只有當下知道的事
  (誰請客、哪個案子),建議填。
- 照片存在手機的瀏覽器儲存空間裡,**補送成功才刪除**。清除網站資料會連帶清掉
  還沒送出的照片,待送筆數畫面上看得到。
- 連線狀態顯示的是「**連不連得到伺服器**」,不是手機有沒有訊號 ——
  手機有 4G 但辦公室電腦沒開時,它會正確顯示「連不到伺服器」。

## 雲端中繼站(ADR-0009)

辦公室電腦沒開時,手機把照片送到 Cloudflare 上的中繼站(`apps/relay`)暫存;
電腦開機後 worker 自己去拉回來建單,之後開著的期間每 5 分鐘再拉一次。
中繼站**只收件、交件**,不辨識、不碰資料庫,照片拉回本機後就從中繼站刪掉。

```
手機 ──(連得到電腦)──────────────────→ 本機 web → AI 辨識
     ──(電腦沒開)──→ 中繼站暫存 ──(電腦開機)──→ 本機 worker 拉回 → AI 辨識
     ──(完全沒網路)──→ 先存手機,有網路時打開 App 再送
```

**出發前**:在連得到辦公室電腦的地方打開 App 任何一頁一次。手機會自動領中繼站的
上傳憑證(效期 90 天,每週自動換新),離線頁也會被快取起來。

### 兩把鑰匙

| 變數 | 放哪裡 | 用途 |
|---|---|---|
| `RELAY_SECRET` | `.env`(web)+ Cloudflare secret | 簽手機的上傳憑證。只能上傳 |
| `RELAY_PULL_TOKEN` | `.env`(worker)+ Cloudflare secret | worker 列出/取件/刪除。不能上傳 |
| `ALLOWED_ORIGINS` | Cloudflare secret | 允許上傳的網頁來源 = 手機開 App 的網址(逗號分隔) |
| `RELAY_URL` | `.env` | 中繼站網址。**留空 = 整個功能關閉** |

兩邊的值必須一致,而且 `RELAY_SECRET` 不能跟 `SESSION_SECRET` 相同(web 啟動時會擋)。

### 第一次部署

需要 Node 與 pnpm(`pnpm install` 過),以及一個 Cloudflare 帳號(免費方案即可)。

```powershell
cd apps\relay
npx wrangler login                          # 瀏覽器授權,只要一次
npx wrangler kv namespace create UPLOADS    # 把印出的 id 填進 wrangler.toml
npx wrangler deploy                         # 印出 https://...workers.dev 網址
```

產生兩把密鑰(各跑一次,值要記下來寫進 `.env`):

```powershell
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```

設定到 Cloudflare(每個指令會要你貼上值):

```powershell
npx wrangler secret put RELAY_SECRET
npx wrangler secret put RELAY_PULL_TOKEN
npx wrangler secret put ALLOWED_ORIGINS     # 例:https://你的電腦名.你的tailnet.ts.net
```

`.env` 補上 `RELAY_URL`、`RELAY_SECRET`、`RELAY_PULL_TOKEN`,然後重建:

```powershell
docker compose up -d --build web worker
docker compose logs worker --tail 5          # 應該看到「雲端中繼站:每 5 分鐘拉取」
```

改了 `apps/relay` 的程式要重新 `pnpm relay:deploy`(容器重建不會更新中繼站)。

### 手機遺失時:換掉上傳密鑰

手機上的憑證只能上傳、看不到任何照片,但還是要作廢:

```powershell
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"   # 新的值
cd apps\relay; npx wrangler secret put RELAY_SECRET                    # 貼上新值
# .env 的 RELAY_SECRET 換成同一個新值,然後
docker compose up -d web
```

其他手機下次連得到辦公室電腦時會自動領新憑證,不用做任何事。

### 免費額度

Workers KV 免費方案每天 1,000 次寫入/刪除/列出、總量 1 GB、單張上限 25 MiB。
自用量遠低於此;worker 每 5 分鐘列出一次 = 每天 288 次。萬一某天超量,
手機那天的上傳會失敗、照片留在手機,隔天自動再送,不會遺失。

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

## 全新安裝(不帶舊資料)

只要 **Docker Desktop 和 Git**,不需要 Node 或 pnpm。

```powershell
git clone https://github.com/sunnerSnow/expense-receipts.git
cd expense-receipts

# .env 要自己準備(裡面有 GEMINI_API_KEY 與 SESSION_SECRET)
Copy-Item <舊機備份>\.env .          # 或 cp .env.example .env 後自己填

docker compose up -d                 # 第一次會建置映像,幾分鐘

# 建表、寫入預設分類、建自己的管理者帳號
docker compose run --rm tools pnpm migrate
docker compose run --rm tools pnpm seed
docker compose run --rm -e NEW_PASSWORD='一句夠長的密碼' tools `
  pnpm user:password -- --email you@company.com --name 你的名字 --role admin
```

`tools` 是一次性的維護容器(compose 裡掛了 profile,平常不會跟著啟動),
裡面有 `drizzle-kit` 與 `tsx` —— 所以**宿主不必裝 Node**。

> `pnpm seed` 會建一個 `admin@example.com` 的開發帳號並印出密碼。
> 建好自己的帳號之後,到網頁的「使用者」把它降成成員,或直接
> `docker compose exec -T db psql -U app -d expense_receipts -c "delete from users where email='admin@example.com'"`
> (只有在它沒有上傳過任何單據時刪得掉)。

驗收:開 http://localhost:3000 用新帳號登入,「分類」頁應該看得到 12 個預設分類。

## 換機器(帶著舊資料)

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

> dump 已經帶了完整 schema,所以**還原舊資料時不用跑 `tools pnpm migrate`**;
> 那是全新安裝才需要的。

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
| 離線頁打不開 | 出發前有沒有在**線上**開過一次(service worker 要先安裝) |
| 離線存的單據沒補送 | 打開 App 任一頁會自動補送;或到離線頁按「立即送出」看錯誤訊息 |
| 送到中繼站的照片沒進系統 | `docker compose logs worker \| Select-String 中繼站`。「留在中繼站沒動」會寫原因(例如經手人對不到帳號),照片不會被刪 |
| 離線頁說「上傳憑證失效」 | 換過 `RELAY_SECRET` 或超過 90 天沒連回辦公室。連得到電腦時打開 App 一次就會更新 |
| 送中繼站時顯示「來源不允許」 | Cloudflare 的 `ALLOWED_ORIGINS` 跟手機開 App 的網址不一致(要含 `https://`,結尾不要 `/`) |
| 離線頁一直說「還沒領到中繼站的憑證」 | `.env` 的 `RELAY_URL` 有沒有設、web 有沒有重建 |
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
