# Roadmap

原則:每個 Phase 結束都要有「當天就能用」的東西。不在當前 Phase 的功能,
先跟使用者確認再做,不要順手做。

## Phase 0 — 骨架 ✅(2026-07-28)

- pnpm monorepo(web / worker / core / db / config)
- Drizzle schema:users、categories、receipts、export_batches
- 電子發票 QR 解析器(`parseEInvoiceQr`)+ 測試
- 扣抵判斷(`assessDeductibility`)、狀態機(`canTransitionStatus`)+ 測試
- 制度文件:README、CLAUDE.md、ADR、conventions、domain-model

## Phase 1 — 可日常使用 ✅(2026-07-28)

目標:從這個 Phase 起,公司單據開始真的存進系統。

- ✅ 簡單登入(email + session;HMAC 簽章 cookie)
- ✅ 拍照/選圖上傳頁(PWA,`<input type="file" accept="image/*" capture="environment">`)
- ✅ 客戶端 jsQR 解碼 → `parseEInvoiceQr` → 電子發票直接入帳(confirmed)
- ✅ QR 解不到的:存影像 + 手動 key 金額/日期/分類(manual 來源,直接 confirmed)
- ✅ 單據列表(月份篩選、狀態篩選)+ 月統計(總額/可扣抵/分類小計)
- ✅ 單據明細:編輯、確認(pending_review→confirmed)、刪除、影像檢視
- ✅ 分類管理(新增/改名/啟用停用)

**Phase 1 已知限制(可日後加固,不改 schema)**:
- ~~登入僅驗 email 是否存在~~ → 2026-08-05 已改為 email + 密碼(scrypt,ADR-0006)
- 分類排序目前只用建立順序(sortOrder),尚無 UI 重新排序
- QR 一次只解一顆條碼(左條碼,含所有帳務欄位);右條碼的接續品項未處理
- QR 解碼在 Web Worker 內做,先掃 1600px 再掃 2600px;8 秒逾時就交給 AI 辨識
- 使用者管理已有網頁介面(`/users`,僅管理者):新增帳號、重設密碼、切換權限。
  CLI(`pnpm user:password`)保留給「還沒有任何管理者帳號」的開機情境
- 使用者可在 /account 自行改密碼與登出
- 刻意不做「刪除使用者」:單據的 uploader_id 指向使用者,刪掉會撞外鍵且讓
  憑證失去經手人。要停用某人目前只能改成成員 + 重設密碼(日後可加 is_active)
- 尚未做:登入嘗試次數限制、雙因素。部署到公網後應補上次數限制

## Phase 2 — AI 辨識 ✅(2026-08-03)

目標:非電子發票的單據不用手 key。

- ✅ worker 接 `receipt.recognize` 佇列:影像 → Gemini vision + structured output
  (擷取:日期、賣方名稱/統編、買方統編、金額、稅額、幣別、發票號碼、分類建議、摘要)
- ✅ 辨識供應商抽成 adapter(`apps/worker/src/recognizer/`),見 ADR-0004
- ✅ 提示詞/輸出 schema/結果驗證在 core:`buildRecognitionPrompt`、
  `buildRecognitionJsonSchema`、`normalizeRecognition`(29 則測試)
- ✅ 台灣單據的正規化規則:民國年轉西元、千分位與貨幣符號、8 碼統編、
  發票號碼格式、5% 營業稅比例交叉檢查
- ✅ 統編比對:`assessDeductibility` 寫入 deductibility 欄位
- ✅ 待確認流程:AI 單據一律 pending_review;明細頁顯示原圖 + 辨識結果 +
  「請核對這幾點」warning 清單,可修正後確認入帳
- ✅ 辨識中自動輪詢更新;失敗顯示原因,可「重新辨識」或改手動填寫
- ✅ 限流退避重試(pg-boss retryLimit 3、指數退避),重試用盡才標記失敗
- ✅ 去重:辨識出的發票號碼撞到唯一索引時標記失敗並提示可能重複上傳

**海外出差單據(2026-08-04 補)**:已支援 —— docType `foreign`、原幣金額、
台灣專屬驗證自動關閉、月統計依幣別分開。**但匯率不換算**:報表只列各幣別小計,
換算成台幣仍是人工。要自動換算需先決定匯率來源(實際刷卡金額 / 月平均匯率 /
會計指定),這是報帳政策問題不是技術問題,等 Phase 3 匯出格式一起定。

**Phase 2 已知限制**:
- 一次辨識一張影像;多張單據拍在同一張照片不會拆開
- 品項明細未擷取(報帳只需要總額與稅額;QR 的品項也還沒入庫)
- 沒有信心分數:改以「warning 清單 + 必經人工確認」代替,模型自評分數不可靠
- 辨識中的單據不出現在月份列表(還沒有日期),改列在列表頁「待處理」區塊

## Phase 3 — 月結匯出 ✅(2026-08-04)

目標:月底交給會計的東西一鍵產出。

- ✅ 選月份 → 預覽待匯出筆數與各幣別金額 → 一鍵派工
- ✅ CSV 清單(UTF-8 BOM、CRLF,Excel 直接開):編號、日期、單據類型、發票號碼、
  賣方名稱/統編、買方統編、幣別、金額、稅額、可否扣抵、會計科目、經手人、摘要、影像檔名
- ✅ 尾端各幣別分別小計(外幣不併入台幣,見 ADR-0005)
- ✅ 影像 zip 打包,檔名以清單流水號為前綴(`007_AB12345678.jpg`)
- ✅ export_batches 紀錄(筆數、各幣別小計、檔案路徑)+ 單據標記 exported(終態)
- ✅ 鐵律 5 的落實:先產檔再 INSERT 批次(不 UPDATE 補路徑);
  批次紀錄與狀態轉換同一交易,失敗整批回滾
- ✅ 重複匯出同月不會重複帶走單據(撈取條件含 `export_batch_id IS NULL`
  + pg-boss singletonKey 防連點)
- ✅ 下載路由做路徑逃逸防護(檔案必須落在 EXPORT_DIR 內)

**月份預設的設計(2026-08-05 修)**:列表與匯出頁的月份不再硬性預設當月 ——
報帳的實際節奏是事後補上個月的單據(出差回來才整理),預設當月會是空的,
使用者會以為資料不見了。改為:當月有資料就用當月,否則自動退到最近一個有資料的
月份,並在畫面上列出所有有單據/可匯出的月份供快速切換。

**Phase 3 已知限制**:
- 只有 CSV,沒有 xlsx(欄位邏輯在 core,要加不用重做;等會計看過再決定)
- 外幣不換算台幣 —— 刻意的,匯率由會計依實際入帳成本決定(ADR-0005)
- 沒有「取消匯出」功能:exported 是終態(鐵律 5)。真的要救只能進 DB 手動處理
- 匯出檔存本機磁碟,與影像同一個問題:部署到雲端前要改物件儲存

## 日常可用化 ✅(2026-08-06)

目標:不必每次手動開兩個終端機,而且手機在外面也連得到。使用模式定調為
**「要用才開電腦」**,不是 24 小時服務 —— 報帳本來就是回辦公室才做的事
(出差先拍在相簿,回來批次上傳)。

- ✅ 開機(登入)自動啟動:`scripts\install-autostart.ps1` 註冊兩個工作排程;
  資料庫靠 `restart: unless-stopped` 交給 Docker Desktop
- ✅ worker 啟動時自己等資料庫(最多兩分鐘),啟動順序不用管
- ✅ worker 啟動時救回卡在「辨識中」的孤兒單據 —— pg-boss 工作預設只保留
  14 天,關機一個月再開就會有單據永遠卡住(core 的 `selectLostRecognitions`)
- ✅ `pnpm build` 補上 `.env` 注入(原本缺了會編不過)
- ✅ 對外連線走 **Tailscale**:不用網域、不開 port、固定網址、自動 HTTPS。
  登入頁不在公網上,所以「登入次數限制」暫時不是上線阻擋條件
- ✅ 維運手冊 [docs/operations.md](operations.md)

**擋住下一步的東西**:`receipts.image_path` 與 `export_batches.file_path` 存的是
絕對路徑,儲存位置一換就讀不到。這是把 web/worker 放進 Docker、或搬上 VPS 的
唯一阻擋條件。修法是改存相對路徑,但 `export_batches` 受鐵律 5 保護不能改既有
資料 —— 要先寫 ADR 決定相容策略。

**還沒做**:登入嘗試次數限制(對公網開放前必補)、自動備份、批次上傳。

## 刻意不做(擱置區)

| 項目 | 原因 |
|---|---|
| 個人記帳模式 | 2026-07-28 決定收斂主軸;schema 留 context 欄位,要加回不用改表 |
| 載具自動同步 | 財政部 API 僅限公司名義申請,已決定不走(ADR-0001) |
| 簽核流程 | 自用規模不需要;確認 = 唯一的人工關卡 |
| 會計系統整合 / 401 申報 | 匯出 CSV 給會計即可 |
| 多租戶 / 商品化 | 明確不做 |
