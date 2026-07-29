# 架構決策紀錄(ADR)

ADR 把「為什麼這樣做」變成可追溯的制度。程式碼會告訴你系統長什麼樣,
只有 ADR 能告訴你(和 AI Agent)**為什麼**長這樣、當初否決了什麼。

## 制度規則

1. **何時寫**:做出「改起來很貴」的決策時 —— 資料庫選型、辨識策略、核心抽象。
   改起來便宜的(UI 樣式、函式命名)不寫 ADR,寫進 conventions 即可。
2. **編號遞增、永不刪除**。決策被推翻時,舊 ADR 狀態改為
   `Superseded by NNNN`,新 ADR 說明為什麼推翻。歷史是資產。
3. **格式**照 [template.md](template.md):Context(當時的情境)、Decision(決定)、
   理由、Consequences(代價與收穫)、被否決的替代方案。
4. **AI Agent 修改架構前必讀相關 ADR**;若修改違反現行 ADR,先開新 ADR 取代舊的,
   再動程式碼。

## 索引

| 編號 | 標題 | 狀態 |
|---|---|---|
| [0001](0001-company-expense-scope.md) | 定位為公司報帳工具,放棄個人模式與財政部 API | Accepted |
| [0002](0002-two-tier-recognition.md) | 兩層辨識:QR 優先,AI 補位,AI 結果必經人工確認 | Accepted |
| [0003](0003-reuse-booking-crm-stack.md) | 沿用 booking-crm 技術棧與工程制度 | Accepted |
