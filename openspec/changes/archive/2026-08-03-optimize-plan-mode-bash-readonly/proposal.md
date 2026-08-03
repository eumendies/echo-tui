## Why

当前 plan mode 的 `run_bash_command` 只读判定采用极窄白名单（仅 `pwd` 与 7 个 git 子命令），大量明显只读的检查命令（如 `ls`、`cat`、`git branch -a`、`git log | head`）被误判为"可能修改状态"而拒绝，导致规划过程中 agent 反复重试或被迫改用低效路径，误拦截率高、体验差。

## What Changes

- 扩展已知只读命令集合：`ls`、`cat`、`head`、`tail`、`wc`、`grep`、`rg`、`echo`、`printf` 以及排除写选项后的 `find`（比 undo 失效保护使用的只读集合更严格：额外拦截 `-fprint/-fprintf/-fls`）。
- 扩展 git 只读子命令：无写形态子命令（`grep/blame/describe/rev-list/for-each-ref/ls-tree/ls-remote/fsck/count-objects/name-rev/shortlog`）直接放行；有写形态子命令（`branch/tag/stash/config/remote`）仅在参数形态明确只读时放行。
- 支持只读组合命令：按 `|`、`&&`、`;`、`||`、换行拆分后逐段递归判定，全部只读才放行；`>`、`>>`、`&>`、`<`、`$()`、反引号、`xargs` 等写类/执行类元字符仍拒绝。
- 共享只读判定：把 plan mode 与 undo 失效保护使用的只读命令判定收敛为同一策略模块，plan 版通过严格选项生效，避免两套逻辑漂移。

## Capabilities

### New Capabilities
<!-- 本次变更不引入新能力，全部落在既有 local-tool-execution 能力的 plan mode 策略需求上。 -->

### Modified Capabilities
- `local-tool-execution`: 修改 "plan mode readonly bash execution policy" 需求，扩大只读 allowlist 范围并允许只读组合命令；同步收紧 `find` 写选项拦截与 git 子命令参数级白名单。

## Impact

- `src/tools/bash-tool-handler.ts`：只读判定逻辑扩展（只读命令集合、git 子命令白名单、组合命令拆分），`PLAN_READONLY_BASH_REJECTION` 拒绝消息同步更新。
- `src/tools/tool-risk-classifier.ts`：调用方无需变更契约，plan mode 分支受益于判定扩展。
- undo 失效保护（change history readonly 判定）与 plan mode 判定收敛为共享策略，需回归验证 undo 语义不变。
- `test/tools/tool-risk-classifier.test.js`、`test/tools/tool-execution.test.js`：新增/调整 plan mode 放行与拒绝用例。
- 无依赖、配置、provider schema 变化；provider-visible tool registry 保持稳定。
