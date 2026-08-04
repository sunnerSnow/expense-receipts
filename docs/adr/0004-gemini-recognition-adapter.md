# 0004. AI 辨識改用 Google Gemini,並把辨識層做成可抽換 adapter

- 狀態:Accepted
- 日期:2026-08-03
- 取代:ADR-0002 中「用 Claude API 做 AI 辨識」這個供應商選擇(兩層辨識策略本身不變)

## Context(當時的情境)

ADR-0002 決定「QR 優先、AI 補位、AI 結果必經人工確認」,並選了 Claude API 作為
AI 層。要開工 Phase 2 時,使用者已經有 Google AI 的使用情境,傾向改用 Gemini,
理由是成本:Google AI Studio 的 flash 系列有免費額度,自用一個月幾十張很可能
落在免費區間內;Claude 則是每張都計費(雖然也只是每月數十元台幣的量級)。

技術上兩家在「看單據影像 → 吐結構化欄位」這件事上能力同級:都有 vision、都有
structured output(強制 JSON schema)。這是擷取任務不是推理任務,模型差異對結果
的影響遠小於「提示詞怎麼寫」與「回傳怎麼驗」。

同時要面對一個現實:供應商會換。模型改版、價格調整、免費額度政策變動,都可能讓
今天的選擇在半年後不成立。

## Decision(決定)

1. **Phase 2 的辨識供應商採用 Google Gemini**(`@google/genai`,Google AI Studio
   金鑰),模型由 `GEMINI_MODEL` 環境變數指定,預設 `gemini-3.5-flash`。
2. **辨識層抽成 adapter 介面**:`apps/worker/src/recognizer/` 定義
   `ReceiptRecognizer`(影像 + 提示 + 輸出 schema → JSON),Gemini 只是其中一個
   實作,由 `createRecognizer()` 這一個工廠決定用誰。
3. **提示詞、輸出 schema、結果驗證留在 `packages/core`**
   (`buildRecognitionPrompt` / `buildRecognitionJsonSchema` /
   `normalizeRecognition`)—— 這些是業務規則,與供應商無關,換供應商時不該重寫。
4. **辨識工作狀態獨立記錄**:receipts 增加 `recognition_status`
   (none/queued/succeeded/failed)、`recognition_error`、`recognition_warnings`。
   單據狀態機(pending_review → confirmed → exported)不受影響,辨識完成後
   status 一律維持 pending_review(鐵律 3)。

## 理由

- **成本**:自用規模下 Gemini flash 的免費額度大概率讓辨識成本歸零;就算超出,
  flash 系列本來就是最便宜的一檔。
- **能力無實質差距**:欄位擷取任務,兩家的 vision + structured output 都夠用,
  而且有「AI 一律進待確認」這道人工關卡兜底,個別誤判不會進帳務。
- **抽 adapter 的成本很低,價值很高**:介面只有一個方法。日後想換回 Claude、
  或同一張單據同時送兩家比對準確率,都不用動 job 與 core。
- **驗證留在 core** 才是真正防線:`normalizeRecognition` 把民國年、千分位、
  8 碼統編、發票號碼格式、5% 稅額比例這些台灣單據的規則變成可測試的純函式,
  換供應商也不會退化。

## Consequences(代價與收穫)

- 收穫:辨識成本趨近零;供應商換手成本壓在單一檔案;台灣單據的驗證規則有 29 則
  單元測試守著。
- 代價:多一層介面(一個實作時看起來多餘);免費額度有每分鐘請求上限,一次上傳
  多張會撞 429 —— 已用 pg-boss 退避重試(retryLimit 3、30 秒起跳、指數退避)吸收。
- 注意:金鑰是 `GEMINI_API_KEY`,只從環境變數讀,錯誤訊息只往外傳
  `error.message`、不整包拋出請求內容(鐵律 8)。
- 注意:AI Studio 現行發的是 `AQ.` 開頭的 authorization key(舊的 `AIzaSy`
  standard key 依 Google 公告 2026-09 起停止受理)。官方 SDK 以
  `x-goog-api-key` 標頭送出,原生端點支援 `AQ.` 金鑰;只有 OpenAI 相容端點
  會出現「Multiple authentication credentials received」—— 本專案不走那條路。
  worker 的 env schema 會驗金鑰前綴形狀,避免貼錯字串只換到一個看不懂的 400。
- 注意:辨識中的單據沒有日期(`invoice_date` 為 NULL),落在所有月份篩選之外,
  列表頁另設「待處理」區塊獨立呈現,避免整批單據看起來消失。

## 被否決的替代方案

- **維持 Claude**:能力沒問題,但在自用規模下,免費額度是實質差異;既然驗證邏輯
  都在 core、換手成本低,沒有理由為「已經寫在 ADR 裡」而付費。
- **不抽 adapter,直接在 job 裡呼叫 Gemini**:省下一個介面,但把供應商細節黏進
  流程,下次要換或要 A/B 比較就得改動 job 與測試。介面只有一個方法,不值得省。
- **用 Gemini 的 App 訂閱(Google AI Pro/Ultra)**:訂閱不含 API 額度,程式無法
  呼叫 —— 這是常見誤解,必須另開 AI Studio 或 Vertex AI 的金鑰。
- **讓模型直接回信任的結果、跳過人工確認**:違反 ADR-0002 的核心判斷,報帳金額
  錯誤的稅務代價遠高於確認一眼的成本。
