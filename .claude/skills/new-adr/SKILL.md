---
name: new-adr
description: 建立新的架構決策紀錄（ADR）。當專案做出新的架構、技術選型或制度決策，或要推翻既有 ADR 時使用。
---

# 建立新 ADR

1. 列出 `docs/adr/` 現有檔案，取下一個四位數編號
2. 依 `docs/adr/template.md` 建立 `NNNN-短英文標題.md`，內容以繁體中文撰寫
3. 必填章節：狀態（Accepted）、日期（今天）、Context、Decision、理由、
   Consequences（代價要誠實寫）、被否決的替代方案
4. 在 `docs/adr/README.md` 的索引表末尾加一列
5. 若本決策推翻舊 ADR：把舊檔狀態改為 `Superseded by NNNN`，**不刪除舊檔**
6. 若決策衍生新的日常規則：同步把規則寫進 `docs/conventions.md`
   （ADR 記歷史，conventions 記現行規則，兩者都要更新）
7. 若決策改變鐵律：同步更新 `CLAUDE.md` 的鐵律清單
