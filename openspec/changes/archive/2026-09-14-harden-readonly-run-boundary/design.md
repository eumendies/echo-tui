## Context

只读运行（BTW、`/review`）此前用文本分类承担 bash 边界：`isPlanReadonlyBashCommand` 白名单放行少量 inspection 命令，其余拒绝；命中 `approval_required` 的命令在 interactive 环境走人工审批。白名单是纯函数、跨平台一致，但已知会漏放会执行外部程序或联网的命令（如 `git diff --textconv`、`git ls-remote`），用户反馈误判率高。沙箱（macOS Seatbelt / Linux bubblewrap）在后续变更中接入，定位为审批流之外的防御纵深。

macOS provider 的可用性判定此前只检查 `/usr/bin/sandbox-exec` 是否存在，而嵌套在另一个 seatbelt 沙箱内的环境会拒绝二次 apply：实测每条命令都 `sandbox_apply: Operation not permitted`（exit 71），既不是降级也不是可用。Linux provider 已有两级探测（二进制发现 + 试运行 + 实例内缓存）与"试运行失败返回 null、按无沙箱降级"的语义。

## Goals / Non-Goals

**Goals:**

- 只读运行的 bash 以"生效的 read-only 沙箱"为主边界：判定生效时任意命令进入既有 executor，效果由内核约束，白名单与人工审批退出。
- 判定与包装同源：执行链路、transient 注记、`/status` 与边界判定共用同一解析输入（配置 revision + executionMode + 运行级收紧）。
- macOS 可用性探测对齐 Linux：两级探测、实例内缓存、失败按无沙箱降级、降级原因可区分。
- `/review` 的只读边界覆盖工具层与子代理层，且不依赖 prompt 自觉。

**Non-Goals:**

- 不把沙箱升级为完整安全边界；沙箱仍是 depth-defense，其能力边界以内核策略为准（例如允许 `process*`，不限制运行哪些程序）。
- 不改变 default（非只读）run 的 bash 策略、审批流程与沙箱档位解析。
- 不改 BTW 的沙箱档位来源：BTW 不声明运行级收紧，只读取用户配置；用户配置为 `read-only` 且沙箱生效时同样适用新的主边界规则。
- 不实现 Linux/macOS 之外的沙箱 provider。

## Decisions

**D1：只读 bash 边界分层——沙箱为主、白名单为 fallback。** 判定条件为"provider 可用 且 生效档位为 `read-only`"（`isReadonlyBashSandboxEffective`）。只看"沙箱可用"不够：`workspace-write` 沙箱不构成只读边界，不得据此放行白名单外命令。生效时 `classifyReadonlyToolCall(call, names, bashSandboxed=true)` 对任意 `run_bash_command` 返回 `safe`；主 loop 同时跳过文本风险分类与审批，命令直接进入 executor。

**D2：判定与包装同源。** 主 loop 与子 loop 都用同一 resolver、同一输入（config.tools.sandbox、executionMode、sandboxModeOverride）解析边界布尔值；registry 包装 bash 时使用相同输入。避免"分类放行但未包装"的裸跑组合。

**D3：沙箱生效时不进入审批。** 只读运行的目的是自动化的只读评审；效果已被内核封死，再弹"写操作审批"是自相矛盾的体验。拒绝路径（写工具、MCP、非只读子代理）保持 fail-closed、不打开 surface。

**D4：macOS 两级探测 + 实例内缓存。** 试运行 `sandbox-exec -p '(version 1)(allow default)' /bin/true`（5s 超时），成功结果缓存；失败时 `isAvailable=false`、`wrapCommand=null`（按无沙箱执行）、`describeUnavailable` 区分"二进制缺失"与"试运行失败"。探测只验证"当前环境能否 apply"，真实 profile 的正确性由支持环境的测试覆盖。

**D5：运行级收紧对 `off` 与 full-access 让位。** `modeOverride: 'read-only'` 只在配置非 `off` 且非 headless full-access 时把生效档位收紧为 `read-only`（恒禁网）；否则维持显式关闭/豁免。收紧结果同时服务包装、注记、`/status` 与边界判定。

**D6：子代理继承方式。** 父 run 把 `toolPolicy` 与 `sandboxModeOverride` 透传给子 loop；子 loop 用同一 resolver 基于同一配置 revision 重算边界（与子 registry 包装 bash 的输入完全一致）。只读父 run 下，非 general 子代理改用 `classifyReadonlyToolCall`（fail-closed、无审批路径）；default 父 run 保持 `classifySubagentToolCall` 的人工升级行为。

**D7：文案反映内核边界。** `/review` prompt 不再声称测试/构建"被执行前拒绝"，改为"写操作与 MCP 被拒绝；shell 命令在只读沙箱内运行，没有沙箱时受严格 allowlist 约束；不要尝试测试或构建"；本地 notice 说明只读边界已启用。

## Risks / Trade-offs

- **执行面依赖内核策略**：沙箱允许 `process*`，因此"任意程序都能跑"，白名单不再限制程序集合；效果面（写入、网络、信号）由内核拒绝。这是接受的分层取舍，已在真实 seatbelt 环境验证。
- **环境相关行为**：沙箱生效与否随平台和内核能力变化。降级路径（无沙箱 + 白名单）保留确定性；`/status` 与 transient 注记保证降级可见。
- **嵌套环境的静默降级**：试运行失败后命令不再逐条失败，而是无沙箱执行——这是与 Linux 对齐的目标行为，但只读运行的 bash 会退回白名单（更严格而非更宽松）。
- **探测成本**：每次 provider 实例化一次 `spawnSync`（缓存在实例内）；`resolveBashSandboxContext` 每次运行调用一次，不随命令数增长。
- **审批体验变化**：只读运行里 `git commit`、`npm install` 这类命令不再弹审批，直接由内核拒绝效果；如未来需要"运行前确认"，需另行设计，不在本次范围。
