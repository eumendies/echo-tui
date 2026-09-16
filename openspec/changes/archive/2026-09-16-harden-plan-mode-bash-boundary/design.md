## Context

plan mode 的 bash 边界此前是纯文本白名单（`isPlanReadonlyBashCommand`）：只放行 `pwd`、只读文件检查命令、只读 git 子命令和纯只读组合命令，`jq`、`node -e`、`awk` 这类明确只读但不在名单内的命令会被直接拒绝；拒绝发生在分类阶段，plan 运行不打开 approval surface。

沙箱已接入 `run_bash_command`：registry 按 `config.tools.sandbox`、`executionMode` 和运行级 `sandboxModeOverride` 解析 `SandboxRuntimeContext` 并包装 bash。但 plan 运行不声明运行级收紧，生效档位就是用户配置（默认 `workspace-write`、网络开启），沙箱只约束"工作区可写"，不构成 plan mode 需要的只读边界。因此 plan mode 不能直接采用只读运行已落地的"生效 read-only 沙箱为主边界、白名单为 fallback"分层——必须先让 plan 运行把沙箱收紧为 read-only。

只读运行（BTW、`/review`）的实现可以直接复用：`isReadonlyBashSandboxEffective` 与执行包装、transient 沙箱注记共用同一份解析输入；`classifyReadonlyToolCall` 已有 `bashSandboxed` 分支。

另有一个与沙箱优先直接相关的缺陷：change checkpoint 失效发生在 `executeBashCommand`，只看 `isChangeHistoryReadonlyBashCommand(command)` 命令文本。生效只读沙箱内执行的 `jq`、`node -e` 等命令无法写工作区，却仍会把当前 checkpoint 标为 invalid 并丢弃更早历史，`/review` 已受影响；plan 采用沙箱优先后同一问题会立即显形。

## Goals / Non-Goals

**Goals:**

- plan mode 的 bash 主边界与只读运行一致：生效 `read-only` 沙箱可用时由内核边界约束任意命令；沙箱不可用时回退严格只读 allowlist。
- plan 运行自动派生运行级 `read-only` 收紧，判定与执行包装、transient 注记同源；该收紧由委派子运行继承。
- plan Worker 继承父运行的沙箱收紧与分层边界。
- 生效只读沙箱内执行的命令不再使 change checkpoint 失效。
- 模型可见约束说明、`/status` 展示与相关 spec 描述同步到分层语义。

**Non-Goals:**

- 不改变 normal/default 运行的风险分类、审批与沙箱正交语义。
- 不改变只读运行的沙箱来源：BTW 仍只读取用户配置；`/review` 仍显式声明收紧。
- 不改变只读子代理（explorer）在 default 父 run 下的人工升级路径；其 bash 仍受父运行只读沙箱约束。
- 不引入新的沙箱档位或"可联网只读"变体；read-only 恒禁网语义保持不变。
- 不裁剪 provider-visible tool schema；plan mode 继续通过执行边界强制只读。

## Decisions

**D1：plan 运行在 runtime 初始化时派生 `read-only` 收紧，并与执行包装同源。** 收紧输入为 `session.sandboxModeOverride ?? (interactionMode === 'plan' && toolPolicy === 'default' ? 'read-only' : undefined)`；派生值同时用于主 registry 的 bash 包装、transient 注记、`isReadonlyBashSandboxEffective` 判定和 subagent port。`off` 与 headless `full-access` 豁免继续由 `resolveEffectiveSandbox` 统一收敛。声明 readonly 工具策略的运行（BTW）不参与派生，继续只读取用户配置或自身声明——避免只读面因为 UI 处于 plan mode 而被放宽为沙箱优先。

**D2：分类器按"生效只读沙箱"切换 plan bash 边界。** `classifyToolCallRisk` 增加 `bashSandboxed` 参数，仅 plan 分支消费：true 时 `run_bash_command` 判定为 safe；false 时保持现有严格 allowlist 与 reject。normal 分支忽略该参数，维持"沙箱不改变普通审批"的正交性。plan 分支的写入型工具与 MCP 拒绝不受影响（沙箱只包装 bash）。生效布尔由 `isReadonlyBashSandboxEffective` 在同一配置 revision、`executionMode` 和派生收紧输入下计算，与 registry 包装一致。

**D3：fallback 保持确定性。** 沙箱不可用（`off`、平台不支持、试运行失败、full-access 豁免）时，plan bash 回退严格 allowlist 与既有 `PLAN_READONLY_BASH_REJECTION` 文案；plan 运行任何情况下都不打开 approval surface。

**D4：Worker 继承父运行边界。** subagent port 已透传 `sandboxModeOverride` 与 `interactionMode`；子 loop 用同一 resolver 基于继承的 override 重算生效布尔并传入 `classifyToolCallRisk`。plan Worker 的写入型工具与 MCP 拒绝保持不变；只读子代理的分类/审批路径也保持既有语义，仅继承 bash 包装收紧。

**D5：undo 失效豁免以"实际包装的只读边界"为准。** `executeBashCommand` 在命令将由生效只读沙箱执行时跳过 `changeRecorder.invalidate`。判定条件为 `sandbox.policy.mode === 'read-only' && sandbox.provider.isAvailable()`，与 runner 的 `wrapCommand` 使用同一 provider 实例和同一缓存探测结果，保证"判定=包装"。workspace-write 或沙箱不可用时保持既有文本失效语义；豁免对任何运行策略生效，因此同时修复 `/review`。

**D6：接受 read-only 沙箱的禁网语义。** read-only 档恒禁网是既有不变量，plan 收紧后 `git ls-remote` 等白名单内联网命令会在沙箱内失败；沙箱不可用的环境仍按无沙箱执行（可联网）。不为个别网络命令在沙箱内开口子：那会把网络边界退回文本分类，并破坏 read-only 的单一语义。需要联网 inspection 时用户可以退出 plan mode 或使用无沙箱环境。

**D7：`/status` 展示 plan 运行级收紧。** `/status` 的沙箱行按当前 interaction mode 解析：plan mode 下应用 `read-only` 收紧，`off` 仍显示 `off`，provider 不可用时带降级原因。这样"收紧后的档位与网络状态与 `/status` 同源"的既有承诺对新收紧来源继续成立。

**D8：文案与 spec 同步。** plan mode 模型可见约束说明更新为描述内核边界，与 `/review` prompt 同风格，目标文案："Plan mode is active. Discuss and inspect only; do not modify files, install dependencies, change branch or repository state, run tests or builds, or use MCP tools. Shell commands either run inside a read-only sandbox (no workspace writes, no network access) or, when no sandbox is available, must stay within readonly inspection commands. Ask the user to switch to /mode normal before implementing." `terminal-tui-prototype` 与 `app-mode-command` 中与 schema-stable、分层边界不一致的 plan mode 描述同步更新；`terminal-tui-prototype` 的 plan requirement 块里历史上混入的 8 个 status line 场景按原文本移回 `footer status line`，避免替换该 requirement 时丢失场景。

**D9：修正 macOS 探针目标二进制（前置修复）。** `probeSandboxExec` 此前执行 `sandbox-exec -p '(version 1)(allow default)' /bin/true`，而 macOS 的 `/bin` 不含 `true`（`true`/`false` 位于 `/usr/bin`）：`execvp` 以 ENOENT 失败、`sandbox-exec` 以 71 退出，provider 因此恒判不可用。后果是"生效只读沙箱为主边界"的分层在 macOS 上从未真正生效（只读运行一直退化为白名单，本次 plan 收紧的主分支同样不可达），`/status` 还把原因误报为"可能嵌套在另一个沙箱内"，`test/sandbox/seatbelt-execution.test.js` 的真实执行用例也整体静默 skip。探针改用 macOS 恒定存在的 `/usr/bin/true`，Linux bubblewrap 的 `/bin/true` 保持不变（主流发行版均存在），并导出探针常量供测试复用、新增存在性守卫。

## Risks / Trade-offs

- **环境相关行为**：同一 plan 命令在不同环境（沙箱可用/不可用）下表现不同。fallback 保留确定性与既有文案；transient 注记与 `/status` 继续描述真实生效的边界。
- **联网命令回归**：沙箱生效时 `git ls-remote` 等白名单内联网 inspection 会失败（原因见 D6）。这是接受的取舍，需要在 spec 与用户可见文案里保持诚实。
- **执行面变宽**：沙箱生效时 plan 可运行任意命令（内核只约束写入、网络和信号），长命令仍受 timeout 与 Esc 中断约束；与 `/review` 的既有取舍一致。
- **沙箱是 depth-defense 而非完整安全边界**：undo 失效豁免依赖内核确实阻止工作区写入；read-only profile 的可写集仅临时目录（真实 seatbelt 已验证）。
- **测试环境限制**：生效分支与回退分支仍靠注入点覆盖（可用/不可用两种环境都要有断言），真实内核边界另由既有 `test/sandbox/seatbelt-execution.test.js` 覆盖；探针修正后该套用例不再静默 skip。
- **修复后沙箱真正生效**：macOS 上探针修正后 provider 恢复可用，plan 与只读运行会真由内核拒绝工作区写入与网络（D6 的取舍在真实环境显形，例如 `git ls-remote`、`curl` 会失败）；若目标环境确实不允许 apply seatbelt，仍按既有降级路径回退白名单。

## Migration Plan

无数据迁移。实现后按仓库验证序列运行 `typecheck`、`test`、`node --check`，并按 AGENTS.md 手工验证交互式 plan 模式。
