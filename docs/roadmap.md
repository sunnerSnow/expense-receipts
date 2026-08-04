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
- 登入僅驗 email 是否存在於 users 表,無密碼/驗證信;自用內部工具可接受,對外前需加固
- 分類排序目前只用建立順序(sortOrder),尚無 UI 重新排序
- QR 一次只解一顆條碼(左條碼,含所有帳務欄位);右條碼的接續品項未處理
- 使用者建立目前只能靠 db seed 或 SQL,尚無使用者管理 UI

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

## Phase 3 — 月結匯出

目標:月底交給會計的東西一鍵產出。

- 選期間 → 產出 CSV/Excel(日期、廠商、統編、金額、稅額、科目、可否扣抵、經手人)
- 影像 zip 打包,檔名對應清單編號
- export_batches 紀錄 + 單據標記 exported(終態,鎖定不可改)
- 匯出格式以會計實際需求為準,開工前先拿範本確認

## 刻意不做(擱置區)

| 項目 | 原因 |
|---|---|
| 個人記帳模式 | 2026-07-28 決定收斂主軸;schema 留 context 欄位,要加回不用改表 |
| 載具自動同步 | 財政部 API 僅限公司名義申請,已決定不走(ADR-0001) |
| 簽核流程 | 自用規模不需要;確認 = 唯一的人工關卡 |
| 會計系統整合 / 401 申報 | 匯出 CSV 給會計即可 |
| 多租戶 / 商品化 | 明確不做 |
