# 0003. 沿用 booking-crm 技術棧與工程制度

- 狀態:Accepted
- 日期:2026-07-28

## Context(當時的情境)

使用者同時維護 booking-crm(TypeScript 全端、Next.js 15、PostgreSQL 17、Drizzle、
pg-boss、pnpm monorepo),並已在該專案建立一套工程制度(CLAUDE.md 鐵律、ADR、
conventions、engineering-playbook)。本專案是第二個專案,由 AI Agent 主力開發、
使用者(後端不熟)review。

## Decision(決定)

技術棧與工程制度整套沿用 booking-crm:

- pnpm monorepo:apps/web(Next.js 15 PWA)、apps/worker(pg-boss)、
  packages/core(純函式業務邏輯)、packages/db(Drizzle)、packages/config(parseEnv)
- PostgreSQL 17(Docker,host port **5433** 避開 booking-crm 的 5432)
- engineering-playbook.md 原樣複製(它本來就設計為可移植制度)
- 平台形式:PWA(拍照走 `<input capture>`),之後需要原生功能再評估 Capacitor

## 理由

- 兩個專案一套心智模型:使用者 review、Agent 開發的慣例完全共通
- 該棧已在 booking-crm 驗證過(typecheck/test 制度、Drizzle 流程都跑通了)
- PWA 免上架審核、一份程式碼,拍照上傳在行動瀏覽器原生支援

## Consequences(代價與收穫)

- 收穫:零學習成本、制度文件直接移植、除錯經驗互通
- 代價:PWA 的相機/離線體驗不如原生 App;版本升級要兩個專案分別維護

## 被否決的替代方案

- 原生 App(Flutter/RN):多一套技術棧,上架流程與自用規模不成比例
- LINE 官方帳號:介面受限,分類管理與匯出還是要 Web 後台,等於做兩套
- 不同後端(如 Supabase/Firebase):與現有制度割裂,使用者要學第二套模式
