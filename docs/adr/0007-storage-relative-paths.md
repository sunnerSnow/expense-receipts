# 0007. 檔案位置存相對鍵值,絕對路徑在讀取時正規化

- 狀態:Accepted
- 日期:2026-08-06

## Context(當時的情境)

`receipts.image_path` 與 `export_batches.file_path` / `image_zip_path` 一直存的是
**絕對路徑**,因為寫入端是 `path.join(env.UPLOAD_DIR, ...)`,而 `UPLOAD_DIR` 經
`resolveFromRepoRoot()` 之後已經是絕對路徑:

```
C:\Users\Uanalyze\Project\expense-receipts\uploads\<uuid>.jpg
C:\Users\Uanalyze\Project\expense-receipts\exports\2026-07\報帳清單_2026-07.csv
```

只要專案換位置,這些路徑就全部失效:換電腦、換 Windows 使用者名稱、把 web/worker
搬進容器、搬上 VPS、改用物件儲存 —— 任何一種都會讓明細頁破圖、匯出檔下載 404。

**而影像是報帳憑證(鐵律 6),讀不到等於憑證遺失。**

這件事在兩個場合同時浮上檯面:

1. 想把 web/worker 收進 docker compose 時,發現容器裡是 Linux 路徑,舊資料全讀不到
2. 使用者要換電腦,而新機器的專案目錄「一定會不一樣」

直覺的修法是「把資料庫裡的路徑改成相對的」,但這條路被鐵律擋住:

- **鐵律 5**:`export_batches` 只允許 INSERT,已匯出的單據不可修改。
  現有 6 筆單據裡有 5 筆是 `exported`,那一筆匯出批次也已存在 —— 都不能 UPDATE。

所以「改資料」不是選項,必須在不動任何一列的前提下解決。

## Decision(決定)

**寫入端存相對鍵值,讀取端把兩種格式都正規化。零資料異動。**

1. **新資料存相對於儲存根目錄的鍵值**,一律用 `/` 分隔:
   - `receipts.image_path` → `<uuid>.jpg`
   - `export_batches.file_path` → `2026-07/報帳清單_2026-07.csv`

2. **讀取時一律經過 `toStorageKey()`**(`packages/core/src/storage-path.ts`,純函式)
   換算成鍵值,再由 `resolveStoredFile()`(`packages/config/src/paths.ts`)組成
   這台機器上的絕對路徑。新舊格式都吃:

   ```
   從後往前找等於根目錄名(uploads / exports)的路徑片段 → 取它後面的部分
   找不到而且本來就是相對路徑 → 它已經是鍵值,原樣沿用
   找不到而且是絕對路徑     → 退回檔名(uploads 是平的目錄,仍然正確)
   ```

3. **不做資料遷移。** 舊的絕對路徑永久留在資料庫裡,靠讀取時正規化相容。

4. **`resolveStoredFile()` 同時是路徑逃逸防線**:`..` 與殘留的磁碟機代號一律
   拒絕,並再次確認結果落在根目錄內。原本下載路由手寫的那段檢查改由它負責。

5. `packages/config` 因此依賴 `packages/core`。core 仍然不依賴任何東西
   (依賴圖仍是 DAG)。判斷邏輯放 core 是因為它必須可被單元測試而且
   **不能碰 `node:path`** —— core 會被瀏覽器端 bundle。

## 理由

- **不動資料就不必替鐵律 5 開例外。** 鐵律的價值在於沒有例外;為了一個工程問題
  去改已匯出的憑證紀錄,等於把「匯出後不可變」這個保證換成「除非有需要」。
- 讀取時正規化是**冪等**的:同一列資料被解析幾次結果都一樣,不會有「遷移到一半」
  的中間狀態,也不需要停機。
- 這個修法一次解決三件事:換機器、搬進容器、搬上 VPS。日後換物件儲存時,
  鍵值本來就是物件儲存要的形式(bucket 內的 key),不用再改一次。
- 「找根目錄名」而不是「比對舊的前綴字串」:不必知道舊機器的路徑長什麼樣,
  也同時處理 Windows 反斜線與 POSIX 斜線。

## Consequences(代價與收穫)

- 收穫:專案可以任意搬家。實測把 `UPLOAD_DIR` / `EXPORT_DIR` 指到完全不同的
  目錄,資料庫一列都沒改,6 張影像與匯出檔照樣讀得到。
- 收穫:路徑逃逸防護集中在一個有測試的函式裡,不再散落在各個 route。
- 代價:資料庫裡會**永久並存兩種格式**。看資料時要知道舊的是絕對路徑;
  任何新增的讀取點都必須走 `resolveStoredFile()`,不能直接 `readFile(row.imagePath)`。
- 代價:`packages/config` 多了一條對 `core` 的依賴。
- 邊界情況:若使用者把舊的絕對路徑裡的根目錄名(`uploads` / `exports`)整個
  改掉,`exports` 的期間子目錄會解析失準(退回檔名)。實務上那些路徑都是由
  `EXPORT_DIR` 組出來的,片段必然找得到。

## 被否決的替代方案

- **UPDATE 資料庫把路徑改成相對的**:直接違反鐵律 5(`export_batches` 只允許
  INSERT、已匯出單據不可修改)。要走這條得先廢掉鐵律 5,代價遠大於收益。
- **新增一欄 `image_key` 並雙寫**:一樣要 UPDATE 既有列才能回填,而且多一個
  欄位就多一種「兩欄不一致」的失敗模式。
- **讀不到就用 `existsSync` 依序試幾個候選路徑**:行為隨檔案系統狀態而變,
  難測試;而且第一個候選(舊絕對路徑)在舊機器上會一直命中,搬家後才爆,
  正是最不希望發生的時機。
- **把專案固定放在同一個路徑**:對「換電腦」有效,對容器與 VPS 無效,
  而且把一個工程問題轉嫁成使用者的操作紀律。
