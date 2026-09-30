# 領域文件

各 engineering skill 探索程式碼時,應如何使用這個 repo 的領域文件。

## 配置:single-context

整個系統只有一個領域(報帳單據),雖然是 pnpm monorepo,但詞彙全 repo 共用。

```
/
├── docs/
│   ├── domain-model.md   ← 詞彙表 + 資料模型(相當於 skill 預設的 CONTEXT.md)
│   └── adr/              ← 架構決策紀錄(0001-…、README.md、template.md)
├── apps/
└── packages/
```

**這個 repo 不使用 `CONTEXT.md` / `CONTEXT-MAP.md`。** skill 若預期要讀 `CONTEXT.md`,改讀 `docs/domain-model.md`;
不要在根目錄另建 `CONTEXT.md`,以免跟 `docs/domain-model.md` 重複而逐漸不一致。

## 探索前先讀

- **`docs/domain-model.md`**:領域詞彙與資料模型。
- **`docs/adr/`**:讀跟你要動的區域有關的 ADR(`docs/adr/README.md` 有索引)。

## 使用詞彙表的用語

輸出中提到領域概念時(issue 標題、重構提案、假設、測試名稱),使用 `docs/domain-model.md` 定義的用語,不要換成詞彙表沒有用的同義詞。

需要的概念若不在詞彙表裡,代表兩種可能:你在發明專案沒用的說法(重新考慮),或詞彙表真的有缺口。
有缺口時補進 `docs/domain-model.md`(`/domain-modeling` 也寫到這個檔案,不是 `CONTEXT.md`)。

## 新的決策

新的架構決策照 `/new-adr` 的流程寫進 `docs/adr/`,沿用既有的編號與 `template.md` 格式。

## 標出 ADR 衝突

輸出若跟既有 ADR 衝突,要明確標出來,不要默默推翻:

> _與 ADR-0007(存相對鍵值)衝突,但值得重新討論,因為…_

依 `CLAUDE.md`:違反現行 ADR 的修改,要先寫新 ADR 取代舊的,再動程式碼。
