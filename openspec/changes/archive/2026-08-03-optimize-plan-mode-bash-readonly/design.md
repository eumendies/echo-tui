## Context

当前 plan mode 的 bash 只读判定位于 `src/tools/bash-tool-handler.ts` 的 `isPlanReadonlyBashCommand`：白名单仅包含 `pwd` 与 7 个 git 子命令（`status/diff/log/show/rev-parse/ls-files/merge-base` 及 `branch --show-current`），且任何 shell 元字符（`; & | < > \` $ ()` 与换行）都会直接拒绝整条命令。

代码库中另有一套更宽的只读判定 `isChangeHistoryReadonlyBashCommand`（用于 undo 失效保护），允许 `ls/cat/head/tail/wc/grep/rg/echo/printf`、排除写选项的 `find` 及 plan git 白名单。两套判定逻辑已漂移：plan mode 明明只读的 `ls`、`cat`、`git branch -a`、`git log | head` 全部被误拒。

plan mode 没有审批流，未知命令只能硬拒绝，因此 fail-closed 白名单是安全前提；优化的方向是**扩大白名单覆盖面**而不是改黑名单。

## Goals / Non-Goals

**Goals:**
- 扩展已知只读命令集合（`ls/cat/head/tail/wc/grep/rg/echo/printf` 与排除写选项后的 `find`），并与 undo 失效保护的只读判定收敛为共享策略。
- 扩展 git 只读子命令：无写形态子命令直接放行，有写形态子命令按参数白名单放行。
- 支持只读组合命令：`|`、`&&`、`;`、`||`、换行 拆分后逐段递归判定；写类元字符仍拒绝。
- 更新拒绝消息，列出允许的命令类别，帮助模型快速纠偏。

**Non-Goals:**
- 不引入 plan mode 审批流（方案 E），保持"plan mode 零写可能、无交互"语义。
- 不做黑名单 fail-open：未知命令一律拒绝。
- 不改变 provider-visible tool registry 与 tool schema。
- 不改变 normal mode 的高风险 bash 审批行为。
- 不改变 headless `--once` 的 readonly policy 与 deny-by-default 语义。

## Decisions

### 1. 收敛为共享只读判定，plan 版用严格选项生效

把只读判定提取为独立模块 `src/tools/readonly-bash-command.ts`，导出：

- `isPlanReadonlyBashCommand(command)`：plan mode 严格判定，允许只读检查命令与纯只读组合命令。
- `isChangeHistoryReadonlyBashCommand(command)`：undo 失效保护宽松判定，额外放行内置 agent-memory 脚本；与 plan 档相同地拆解组合命令逐段判定（memory 脚本整条优先判定，因其专用 tokenizer 支持引号拼接而拆段器不支持）。
- 两个函数共享单命令判定核心 `isReadonlySingleArgv`，两套阈值（find 拦截集合、pwd 是否要求无参）以显式常量 `PLAN_SINGLE_COMMAND_OPTIONS` / `CHANGE_HISTORY_SINGLE_COMMAND_OPTIONS` 表达，不通过布尔参数路由，避免隐藏结构性差异。现有调用方契约不变。

**备选**：继续在 `bash-tool-handler.ts` 内扩展。否决：判定逻辑会显著变大，且两个调用方语义不同（plan 拦截 vs undo 失效保护），独立模块职责更清晰、便于单测。**备选**：对外只暴露 `isReadonlyBashCommand(command, {strict})` 一个函数并用布尔路由。否决：strict 分支是两个结构不同的策略（组合拆分 vs memory 脚本），布尔参数掩盖差异且默认值易误用，最终实现采用两个具体函数 + 共享核心。

### 2. 组合命令：引号感知拆分 + 逐段递归判定

新增引号感知的顶层拆分（不拆引号内的元字符），按 `|`、`&&`、`;`、`||`、`\n` 切段；每段 trim 后递归调用严格只读判定。任一段含写类元字符（`>`、`>>`、`&>`、`<`、`$(`、反引号）或不在只读集合内 → 整体拒绝。

保留现有 `parseSingleCommand` 的引号处理：引号内内容不参与命令解析；双引号内 `$`/反引号已被现有 tokenizer 拒绝，新增拆分器同样保留该约束。

**理由**：`git log | head`、`cat x | grep y`、`git status && git diff` 是模型的高频只读形态；逐段校验后安全边界不破。`xargs` 不在只读集合内，`ls | xargs rm` 仍被拒。

**宽松模式（undo 失效保护）同样拆段**：纯只读组合（`git status && git diff`）不再使 undo 失效，与单命令行为一致；写段（`rm`、`touch`、git 写形态等）在段级必然被拒 → 整体 false → 仍使 undo 失效。拆段器对引号拼接（`'a'\''b'`）存在完备性限制：误切只会让段 parse 失败 → 保守失效，不存在误放路径；memory 脚本因依赖引号拼接参数，走整条优先判定规避该限制。

### 3. git 子命令参数级白名单

- **无写形态子命令直接放行**：`grep blame describe rev-list for-each-ref ls-tree ls-remote fsck count-objects name-rev shortlog`（这些子命令不存在写形态）。
- **有写形态子命令按参数白名单**：
  - `branch`：参数必须全部命中只读选项（`-a -r -l --list -v -vv --all --remotes --verbose --no-color --merged --no-merged --sort`）且不允许位置参数（`git branch foo` 是创建分支）。
  - `tag`：参数必须命中 `-l --list --sort -n` 且无位置参数（`git tag v1` 创建标签）。
  - `stash`：仅 `list`、`show` 两种子形态（`git stash push/pop/apply/drop/clear` 拒绝）。
  - `config`：仅允许读取类选项（`--get --get-all --get-regexp --list -l --type --show-origin --show-scope -z --null --local --global --system --worktree --file`），位置参数至多 1 个（2 个即 key+value 赋值，拒绝）。
  - `remote`：无参、`-v/--verbose`、`show <name>`、`get-url <name>` 放行，其余拒绝。
- 现有 `--output/--ext-diff/--external-diff/--output=` 拦截保持，并对所有 git 子命令统一扫描。

### 4. find 写选项严格化

宽松模式沿用现有 `-delete -exec -execdir -ok -okdir` 拦截；严格模式额外拦截 `-fprint -fprintf -fls`（GNU find 的写文件选项，现有 change history 判定漏了这三项，plan 版不能跟着漏）。

### 5. 拒绝消息更新

`PLAN_READONLY_BASH_REJECTION` 改为按类别列举允许命令（`pwd`、文件查看类 `ls/cat/head/tail/wc/grep/rg/find`、只读 git 检查、只读管道组合），并保留"退出 plan mode 才能执行"的提示，降低模型重试次数。

## Risks / Trade-offs

- [find 仍可能存在未覆盖的写选项] → GNU find 写类选项集合封闭（`-delete/-fprint/-fprintf/-fls` 等），统一走严格选项集合；未知命令不在此集合内一律拒绝。
- [git 参数白名单漏放写形态] → 白名单只放明确只读形态，位置参数超限或未知选项一律拒绝（fail-closed），宁可继续误拒也不误放。
- [组合拆分引入解析 bug 导致误放行] → 拆分器为纯 token 级扫描、不执行 shell；`>`/`$()`/反引号 在段级仍被拒；补充引号内元字符用例测试。
- [undo 失效保护语义回归] → 宽松模式保持现有集合与行为不变，`tool-execution.test.js` 既有用例回归验证。
- [误放 `echo`/`printf`] → 二者无写路径，`>` 重定向被拒，安全。

## Migration Plan

- 纯增量重构：先提取共享模块（行为不变），再逐步放宽 plan 白名单，每步跑 `npm run typecheck`、`npm test`。
- 无配置、无数据迁移；回滚即还原 `bash-tool-handler.ts` 判定即可。

## Open Questions

- 无阻塞项。`git config --file` 读取已放行，写形态由位置参数数量拦截，若后续出现误放行案例再收紧。
