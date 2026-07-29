# 工程手冊（Engineering Playbook）

這份文件是**可移植的制度**：它描述的不是這個專案，而是「如何把判斷變成制度、
把制度變成 AI Agent 可以執行的系統」。開新專案或重構舊專案時，把這套搬過去。

## 一、文件即制度：六種文件，六個職責

| 文件 | 回答的問題 | 讀者 | 更新時機 |
|---|---|---|---|
| `README.md` | 這是什麼？怎麼跑起來？ | 人（新成員） | 啟動方式改變時 |
| `CLAUDE.md` | Agent 動手前必須知道什麼？ | AI Agent（每次對話自動載入） | 鐵律增減時 |
| `docs/adr/` | 為什麼這樣設計？當初否決了什麼？ | 人 + Agent | 每個貴的決策當下 |
| `docs/conventions.md` | 具體怎麼寫？紅線在哪？ | 人 + Agent | 慣例成形時 |
| `docs/domain-model.md` | 系統的形狀是什麼？ | 人 + Agent | 承重牆變動時 |
| `docs/roadmap.md` | 現在做什麼、刻意不做什麼？ | 人 | 每個 Phase 邊界 |

分工原則：**判斷 → ADR（一次性、有日期、不可變），規則 → conventions（現行有效、
可演化），地圖 → domain-model（隨時反映現狀）**。三者絕不混寫：
ADR 記歷史，conventions 記現在，讓 Agent 不必讀完歷史才知道現行規則。

## 二、AI Agent Harness 四原則

把 AI Agent 當成「每天都是第一天上班、但執行力極強的工程師」——
制度設計的目標是讓這樣的工程師不犯錯。

1. **判斷寫成規則。** 對話中做出的每個架構判斷，當天沉澱進 ADR 或 conventions。
   沒寫下來的判斷，下一個 session 的 Agent（和三個月後的你）等於沒做過。
2. **規則要可驗證。** 每條規則盡量配一個機器檢查：`pnpm typecheck`、`pnpm test`、
   lint rule、CI。Agent 的完成定義（DoD）必須是可執行的指令，不是「看起來沒問題」。
3. **不變量下沉到最低層。** 同一條規則的執行強度排序：
   資料庫約束 > 型別系統 > 測試 > lint > code review > 文件裡的一句話。
   最重要的不變量（防撞單、org_id 隔離、ledger 只增）要下沉到資料庫層 ——
   那裡連 Agent 的失誤都擋得住。
4. **重複流程做成 Skill。**「每次都要照同樣步驟做」的事（開 ADR、加產業範本、
   改 schema）寫成 `.claude/skills/`，Agent 用指令觸發而不是每次重新想流程。

## 三、標準工作流程

### 新功能
1. 讀 `docs/roadmap.md` 確認在當前 Phase 內（不在 → 先討論，不要順手做）
2. 讀相關 ADR 與 `docs/conventions.md`
3. 業務邏輯寫在 `packages/core`（純函式 + 測試），IO 寫在 apps
4. `pnpm typecheck && pnpm test` 全綠
5. 若過程中做了新的架構判斷 → 立刻寫 ADR

### 改資料庫
見 `docs/conventions.md` 第 3 節的四步流程。關鍵：**產出的 SQL 要人工 review**。

### 重構既有專案導入這套制度（順序很重要）
1. 先寫 `CLAUDE.md`：只寫「絕對不能違反的 3–5 條鐵律」＋常用指令
2. 補追溯性 ADR：把「當初為什麼這樣做」還原成 3–5 份 ADR（訪談 + git log 考古）
3. 建立可驗證的 DoD：讓 typecheck / test 在 CI 跑起來
4. 之後每個新決策即時寫 ADR —— 制度從今天開始，不求還原全部歷史
5. 最後才做 skills 自動化（沒有前四步，自動化只是加速犯錯）

### 何時寫 ADR（判斷標準）
問一個問題：「這個決定半年後改，要付多少成本？」
- 改一天內：不寫，直接做
- 改一週以上或影響資料模型：寫 ADR
- 拿不準：寫，寫 ADR 的成本遠低於考古的成本

## 四、複製到新專案的 Checklist

- [ ] 建 `docs/adr/`（拷貝 template.md + README.md 的制度規則）
- [ ] 建 `CLAUDE.md`：專案一句話 + 架構地圖 + 鐵律 + 指令 + DoD
- [ ] 建 `docs/conventions.md`：先只寫鐵律，慣例隨開發累積
- [ ] 定義可執行的 DoD（typecheck / test / lint 指令）
- [ ] 第一批 ADR：租戶模型、資料庫選型、語言框架、部署形態（每案必有的四個決策）
- [ ] `.claude/skills/new-adr` 拷貝過去
- [ ] 不變量清單：列出「絕不能發生的事」，逐條下沉到資料庫約束或型別

## 五、本專案的實例對照

| 原則 | 在本專案的落地 |
|---|---|
| 判斷寫成規則 | 10 份 ADR（docs/adr/0001–0010） |
| 規則可驗證 | `pnpm typecheck` + core 100% 單元測試 |
| 不變量下沉 | 防撞單 = DB 排除約束；隔離 = org_id NOT NULL + RLS；堂數 = ledger 只增 |
| 流程做成 Skill | `.claude/skills/new-adr`、`.claude/skills/new-industry-module` |
