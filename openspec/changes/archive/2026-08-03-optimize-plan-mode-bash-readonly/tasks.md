## 1. 提取共享只读判定模块（行为不变的增量重构）

- [x] 1.1 新建 `src/tools/readonly-bash-command.ts`，迁移 `parseSingleCommand`、`isBlockedGitOption`、`BLOCKED_GIT_OPTIONS` 与 `GIT_READONLY_SUBCOMMANDS`，导出 `isPlanReadonlyBashCommand` 与 `isChangeHistoryReadonlyBashCommand` 两个具体判定函数（后者额外放行内置 agent-memory 脚本），共享单命令判定核心 `isReadonlySingleArgv`，两套阈值以显式常量 `PLAN_SINGLE_COMMAND_OPTIONS` / `CHANGE_HISTORY_SINGLE_COMMAND_OPTIONS` 表达（宽松模式保持现有 change history 集合与行为）
- [x] 1.2 迁移 `isChangeHistoryReadonlyBashCommand`（含 agent-memory 脚本判定）为宽松模式薄封装，`bash-tool-handler.ts` 保留导出，确认 `tool-execution.test.js` 既有用例不变
- [x] 1.3 迁移 `isPlanReadonlyBashCommand` 为严格模式薄封装，确认 `tool-risk-classifier.test.js` 既有 plan mode 用例不变

## 2. 扩展已知只读命令集合（方案 A）

- [x] 2.1 严格模式放行 `ls/cat/head/tail/wc/grep/rg/echo/printf`（复用宽松模式集合），`pwd` 无参限制保持不变
- [x] 2.2 严格模式 `find` 放行改为：排除 `-delete/-exec/-execdir/-ok/-okdir` 与 `-fprint/-fprintf/-fls`；宽松模式维持现有拦截集合不变

## 3. 扩展 git 只读子命令（方案 B）

- [x] 3.1 无写形态 git 子命令直接放行：`grep blame describe rev-list for-each-ref ls-tree ls-remote fsck count-objects name-rev shortlog`
- [x] 3.2 `branch` 参数白名单：仅只读选项（`-a -r -l --list -v -vv --all --remotes --verbose --no-color --merged --no-merged --sort`），禁止位置参数
- [x] 3.3 `tag` 参数白名单：仅 `-l --list --sort -n`，禁止位置参数
- [x] 3.4 `stash` 仅放行 `list`、`show` 子形态
- [x] 3.5 `config` 仅放行读取类选项（`--get --get-all --get-regexp --list -l --type --show-origin --show-scope -z --null --local --global --system --worktree --file`）且位置参数至多 1 个
- [x] 3.6 `remote` 仅放行无参、`-v/--verbose`、`show <name>`、`get-url <name>` 形态
- [x] 3.7 `--output/--ext-diff/--external-diff/--output=` 拦截对所有 git 子命令统一扫描

## 4. 支持只读组合命令（方案 C）

- [x] 4.1 实现引号感知的顶层命令拆分器：按 `|`、`&&`、`;`、`||`、换行切段，引号内元字符不拆分
- [x] 4.2 组合命令逐段递归走严格只读判定，任一段不满足即整体拒绝；段级保留写类元字符（`>` `>>` `&>` `<` `$(` 反引号）拒绝
- [x] 4.3 更新 `PLAN_READONLY_BASH_REJECTION` 拒绝消息，按类别列举允许命令与只读组合示例

## 5. 测试与验证

- [x] 5.1 `tool-risk-classifier.test.js`：plan mode 放行 `ls -la`、`cat package.json`、`find . -name "*.ts"`、`git branch -a`、`git grep foo`、`git log --oneline | head -20`、`ls && git status`
- [x] 5.2 `tool-risk-classifier.test.js`：plan mode 拒绝 `find . -exec touch {} \;`、`find . -fprint out.txt`、`git config user.email x`、`git stash push`、`git branch feature`、`echo hi > file`、`cat "$(ls)"`、`git ls-files | xargs rm`
- [x] 5.3 `tool-execution.test.js`：undo 失效保护（宽松模式）行为回归，确认 change history 判定与 agent-memory 脚本用例不变
- [x] 5.4 依次运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`
