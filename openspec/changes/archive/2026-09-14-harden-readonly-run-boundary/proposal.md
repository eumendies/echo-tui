## Why

`/review` 需要不依赖提示词自觉的硬只读边界，但只读运行里的 bash 边界此前完全依赖文本白名单：白名单误判率高（`git diff --textconv` 这类会执行外部程序、`git ls-remote` 这类会联网的命令会被放行），而它本来就是沙箱未就绪时的临时件。同时 macOS 沙箱的"可用"判定只看二进制是否存在，在嵌套沙箱环境里命令会全部以 `sandbox_apply` 被拒（exit 71）硬失败，而不是按既有设计降级为无沙箱执行。

本次变更把"生效的 read-only 沙箱"提升为只读运行的 bash 主边界，白名单降级为沙箱不可用时的 fallback，并让这一判定与执行包装同源。

## What Changes

- `/review` workflow 声明运行级只读工具策略（`toolPolicy: readonly`）与只读沙箱收紧（`sandboxModeOverride: 'read-only'`），启动时追加说明只读边界的本地 notice；该 turn 内写文件工具、MCP、`ask_user_questions` 与非 readonly 子代理在审批与执行前被 fail-closed 拒绝。
- 只读运行的 bash 边界分层：当生效沙箱可用且档位为 `read-only` 时，`run_bash_command` 交给内核沙箱作为主边界（任意命令可执行，写入/网络/信号由内核拒绝），文本白名单与人工审批退出；否则回退现有严格只读白名单。
- macOS Seatbelt 增加两级可用性探测（二进制存在 + 最小 profile 试运行），结果按 provider 实例缓存；试运行失败时报告不可用、按无沙箱降级，并区分"二进制缺失"与"试运行失败"两类降级原因。
- 只读父 run 下，只读子代理的 bash 继承同一 fail-closed 边界与沙箱收紧；default 父 run 保持现有"未知 Bash 人工升级"行为。
- 沙箱策略新增运行级 `read-only` 收紧：仅对非 `off` 配置生效，`off` 与 headless `full-access` 豁免语义不变，执行包装、transient 注记、`/status` 与只读边界判定共用同一收紧结果。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `bash-sandbox`: 增加 macOS Seatbelt 试运行探测与降级原因区分；增加运行级只读收紧；明确只读运行的沙箱 bash 主边界。
- `local-tool-execution`: readonly policy 的 bash 规则改为"生效只读沙箱为主边界、严格白名单为 fallback"；拒绝文案通用化；补充只读运行的委派目标限制。
- `readonly-subagent-delegation`: 只读父 run 下只读子代理的 Bash 继承 fail-closed 只读边界；default 父 run 保持人工升级。
- `built-in-agent-workflows`: `/review` 声明运行级只读边界并追加本地 notice；plan mode 切换说明不再声称可执行测试。

## Impact

- `src/sandbox/macos-seatbelt.ts`、`src/sandbox/provider.ts`、`src/sandbox/types.ts`：试运行探测、运行级收紧、只读 bash 生效判定。
- `src/tools/tool-risk-classifier.ts`、`src/tools/tool-registry.ts`、`src/agent/loop-runtime/*`、`src/agent/subagent/runtime.ts`：分类分支、装配透传、主/子 loop 边界继承。
- `src/commands/agent-workflows/*`、`src/app/composer-submission-controller.ts`、`src/app/assistant-turn-runner.ts`、`src/types/*`：workflow 声明的运行级策略透传到 session。
- `test/sandbox/*`、`test/tools/tool-risk-classifier.test.js`、`test/agent/*`、`test/commands/*`：两分支覆盖与文案断言。
- `docs/tui-architecture.md`：agent workflow、Bash 沙箱与子代理边界描述同步。
- 不改变：default（非只读）run 的行为、headless `deny`/`full-access` 审批政策、审批与沙箱正交的既有语义、BTW 仍只读取用户配置的沙箱档位。
