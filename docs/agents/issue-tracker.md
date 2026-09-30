# Issue tracker:GitHub

這個 repo 的 issue 與 spec 放在 GitHub Issues(`sunnerSnow/expense-receipts`)。所有操作一律用 `gh` CLI。

## 慣例

- **建立 issue**:`gh issue create --title "..." --body "..."`。多行內容用 heredoc。
- **讀取 issue**:`gh issue view <number> --comments`,用 `jq` 篩選留言,並一併取得標籤。
- **列出 issue**:`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`,視需要加 `--label` 與 `--state` 篩選。
- **留言**:`gh issue comment <number> --body "..."`
- **加/移除標籤**:`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **關閉**:`gh issue close <number> --comment "..."`

repo 由 `git remote -v` 推得;在 clone 內執行 `gh` 會自動判斷。

## PR 作為 triage 來源

**PRs as a request surface: no.** _(若這個 repo 把外部 PR 當成功能需求處理,改成 `yes`;`/triage` 會讀這個旗標。)_

設為 `yes` 時,PR 與 issue 共用同一套標籤與狀態,改用對應的 `gh pr` 指令:

- **讀取 PR**:`gh pr view <number> --comments`,diff 用 `gh pr diff <number>`。
- **列出待 triage 的外部 PR**:`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`,只保留 `authorAssociation` 為 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的(排除 `OWNER`/`MEMBER`/`COLLABORATOR`)。
- **留言/標籤/關閉**:`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 與 PR 共用編號,單寫 `#42` 可能是任一種:先試 `gh pr view 42`,失敗再用 `gh issue view 42`。

## 當 skill 說「發佈到 issue tracker」

建立一個 GitHub issue。

## 當 skill 說「取得相關 ticket」

執行 `gh issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一張 issue,底下的 **child** issue 就是各張 ticket。

- **Map**:一張帶 `wayfinder:map` 標籤的 issue,內文包含 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **Child ticket**:以 GitHub sub-issue 掛在 map 底下(透過 `gh api` 呼叫 sub-issues endpoint)。若未啟用 sub-issue,就把 child 加進 map 內文的 task list,並在 child 內文最上方寫 `Part of #<map>`。標籤:`wayfinder:<type>`(`research`/`prototype`/`grilling`/`task`)。認領後 assign 給負責的開發者。
- **Blocking**:用 GitHub **原生 issue dependencies**(正式且在 UI 可見的表示法)。新增依賴:`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,其中 `<blocker-db-id>` 是 blocker 的數字 **database id**(`gh api repos/<owner>/<repo>/issues/<n> --jq .id`,_不是_ `#number` 也不是 `node_id`)。GitHub 會回報 `issue_dependencies_summary.blocked_by`(只算未關閉的 blocker,即當下的閘門)。若無法使用 dependencies,退回在 child 內文最上方寫 `Blocked by: #<n>, #<n>`。所有 blocker 都關閉後,ticket 才算解除阻擋。
- **Frontier 查詢**:列出 map 底下未關閉的 child(`gh issue list --state open`,範圍限定在 map 的 sub-issue/task list),排除有未關閉 blocker(`issue_dependencies_summary.blocked_by > 0`,或 `Blocked by` 那行有未關閉的 issue)或已有 assignee 的;依 map 中的順序取第一張。
- **認領**:`gh issue edit <n> --add-assignee @me`,這是該 session 的第一個寫入動作。
- **解決**:`gh issue comment <n> --body "<answer>"`,接著 `gh issue close <n>`,再把一行 context 指標(摘要 + 連結)附加到 map 的 Decisions-so-far。
