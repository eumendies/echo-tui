## Why

plan mode 的 bash 边界目前是纯文本白名单：只放行明确的 inspection 命令，`jq`、`node -e`、`sed -n` 这类只读命令会被误判拒绝；plan 运行也不声明运行级沙箱收紧，沿用用户配置档位（默认 `workspace-write`），并不构成真正的只读边界，因此不能直接照搬只读运行已经验证过的"生效 read-only 沙箱为主边界、白名单为 fallback"分层。

本次把该分层引入 plan mode，并处理落地前置条件与既有缺口：

- plan 运行需要自动派生运行级 `read-only` 沙箱收紧，否则沙箱生效后会放行工作区写入。
- change checkpoint 失效判定只看命令文本、不看执行沙箱：生效只读沙箱内执行的命令无法写工作区，却仍会 invalidate 并丢弃更早的 undo 历史（`/review` 已受影响）。
- plan Worker 需要继承父运行的沙箱收紧与分层分类，避免绕过只读边界。
- macOS 可用性探针此前指向 `/bin/true`，该路径在 macOS 上不存在（`true` 位于 `/usr/bin`），使 Seatbelt provider 在整台机器上恒判不可用：只读运行与本次 plan 收紧的"沙箱优先"分层在 macOS 上从未真正生效，`/status` 还把降级原因误报为"可能嵌套在另一个沙箱内"。

## What Changes

- plan interaction mode 的 default 工具策略运行在配置档位非 `off` 且未被 headless `full-access` 豁免时自动派生运行级 `read-only` 沙箱收紧，并由委派子运行继承；声明 readonly 工具策略的运行（BTW、`/review`）保持既有沙箱来源。
- plan mode 的 `run_bash_command` 分类分层：生效 `read-only` 沙箱可用时任意命令判定为 safe 并直接进入执行链路（不打开审批，工作区写入与网络由内核边界拒绝）；沙箱不可用时回退现有严格只读 allowlist 与拒绝文案。
- plan Worker 复用同一生效边界：沙箱可用时任意 bash 直接执行，不可用时按严格 allowlist 拒绝；写入型工具与 MCP 的 plan 拒绝语义不变。
- 生效只读沙箱内执行的 bash 命令不再使 change checkpoint 失效（同时修复 `/review` 的同类问题）。
- plan mode 模型可见约束说明与 `/status` 展示同步为"沙箱 / allowlist"分层语义。
- 同步 `terminal-tui-prototype` 与 `app-mode-command` 中与现行 schema-stable、分层边界不一致的 plan mode 描述，并把历史上混入 plan requirement 的 status line 场景按原文移回 `footer status line`。
- 修正 macOS Seatbelt 探针的目标二进制（`/bin/true` → `/usr/bin/true`），让沙箱在真实支持的环境下真正生效；同步真实执行用例的探测 helper 并加回归守卫，避免探针路径再次漂移导致用例静默 skip。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `bash-sandbox`: plan 运行自动派生只读收紧；plan 运行的 bash 与只读运行一样在生效沙箱下由内核边界兜底。
- `local-tool-execution`: plan mode bash 策略改为"生效只读沙箱为主边界、严格 allowlist 为 fallback"。
- `general-purpose-worker-subagent`: plan Worker 继承父运行的沙箱收紧与分层 bash 边界。
- `undo-command`: 生效只读沙箱内执行的命令不使 change checkpoint 失效。
- `terminal-tui-prototype`: plan mode inspection、执行边界与 guidance 描述同步到分层语义。
- `app-mode-command`: plan mode runtime enforcement 描述同步到分层边界。

## Impact

- `src/agent/loop-runtime/agent-loop-runtime.ts`：plan 运行派生 `sandboxModeOverride`，计算 plan bash 生效边界并传入分类。
- `src/agent/loop-runtime/subagent-loop-runtime.ts`：general Worker 复用同一生效边界。
- `src/tools/tool-risk-classifier.ts`：plan 分支接受 bash 沙箱生效标志。
- `src/tools/bash-tool-handler.ts`：生效只读沙箱内跳过 change checkpoint 失效。
- `src/app/state/app-context.ts`：plan mode 约束说明文案。
- `src/app/command/status-command-ports.ts`：`/status` 沙箱行按当前 interaction mode 反映 plan 运行级收紧。
- `src/sandbox/macos-seatbelt.ts`：探针目标二进制修正（沙箱优先分层能在 macOS 真正生效的前置修复），并导出探针常量供测试复用。
- `test/tools/tool-risk-classifier.test.js`、`test/agent/agent-loop-runtime.test.js`、`test/agent/subagent-runtime.test.js`、`test/tools/tool-execution.test.js`：分层、继承与 undo 失效用例。
- `test/sandbox/seatbelt-profile.test.js`、`test/sandbox/seatbelt-execution.test.js`：探针目标存在性守卫与真实执行用例的探测 helper 同步。
- `docs/tui-architecture.md`：plan mode bash 边界、收紧派生与 undo 失效语义同步。
- 不改变：normal/default run 的分类与审批、readonly run 的沙箱来源、只读子代理（explorer）的审批路径、headless 审批政策、provider-visible tool schema。
