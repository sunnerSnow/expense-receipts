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

## Phase 2 — AI 辨識

目標:非電子發票的單據不用手 key。

- worker 接 `receipt.recognize` 佇列:影像 → Claude API vision + structured outputs
  (擷取:日期、賣方名稱/統編、買方統編、金額、稅額、幣別、發票號碼、分類建議)
- 統編比對:`assessDeductibility` 寫入 deductibility 欄位
- 待確認佇列 UI:辨識結果 + 原圖並排,一鍵確認/修正
- 辨識失敗/低信心 fallback 到手動 key

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
