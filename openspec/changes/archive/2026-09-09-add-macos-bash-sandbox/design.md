## Context

当前本地 shell 执行只有一个收口点:`src/tools/bash-command-runner.ts` 的 `runBashCommand()`,以 `spawn('/bin/bash', ['-lc', command])` 执行命令。调用方有两个:`run_bash_command` 工具 handler(主 agent、子 agent、BTW、headless `--once` 全部经过),以及用户 shell 模式(`src/app/main.ts` 直调)。timeout、Esc 中断(`detached` + 进程组 kill)、输出截断与 offload 都在 runner 内实现。

安全防线目前只有 `tool-risk-classifier.ts` 的风险模式识别与人工审批,属于"软防线":未命中风险规则的命令可无限制读写文件系统与访问网络。macOS 自带 `/usr/bin/sandbox-exec`(Seatbelt)可以零依赖提供 OS 级写/网边界;ROADMAP 已将其列为待办 Feature。用户已确认:默认档位为 `workspace-write` 且网络开启,v1 范围仅限 agent 的 bash 工具。

既有事实约束:

- tool result offload 文件由 Node 主进程写入 `~/.echo/echo_tui/...`,不经过沙箱子进程,profile 无需为其放行。
- 内置 agent-memory skill 通过 `run_bash_command` 执行 `node <builtin>/agent-memory/scripts/memory.js`,写入 `~/.echo/agent-memory/`,默认开启沙箱必须为其保留写权限。
- `executionMode`(headless `full-access` / `deny`)在 agent loop runtime 已知,但尚未传入 `prepareAgent` → `createDefaultToolRegistry`。
- macOS 上 `/tmp`、`/var` 是指向 `/private/tmp`、`/private/var` 的 symlink,Seatbelt 匹配真实路径,可写路径必须 realpath 归一化。

## Goals / Non-Goals

**Goals:**

- 在 bash 工具执行链路上为 agent 命令提供 OS 级沙箱边界(写 + 网络),默认在 macOS 上生效。
- 以 provider-neutral 抽象隔离平台差异,后续接入 Linux/Windows 沙箱只需新增 provider。
- 保持既有执行语义不变:timeout、Esc 中断、进程组 kill、输出截断/offload、风险审批流。
- 沙箱不可用(非 darwin、`sandbox-exec` 缺失)时显式可观测地退化,而不是静默或失败。

**Non-Goals:**

- 不给用户 shell 模式、lifecycle hooks、MCP server 进程、Node 侧内置工具套沙箱。
- 不提供最小权限级 profile(mach-lookup、exec 路径白名单等后续迭代收紧)。
- 不实现 denial 日志采集、`(debug deny)` 调试通道。
- 不让审批决策反向放宽沙箱(如批准某命令后临时开启网络)。
- 不声称沙箱是完整安全边界;它只是审批流之外的防御纵深。

## Decisions

### D1:以 `sandbox-exec` 子进程包装 argv,而非 FFI 或第三方沙箱

`sandbox-exec -p <profile> <shell> -lc <command>` 作为 spawn argv 前缀。备选方案:通过 FFI 调用 `sandbox_init`(需要 native 依赖,违背项目"无第三方 TUI/运行时依赖"的约束);Linux bubblewrap(平台不符,留给后续 provider)。`sandbox-exec` 虽被 Apple 标记 deprecated,但至今可用,Codex CLI 等同类工具同路径;其移除风险由可用性探测 + 显式降级兜底。

### D2:抽象切面为"argv 包装器",profile 生成为 provider 内部纯函数

`SandboxProvider` 只暴露 `wrapCommand({command, shell, cwd}, policy): string[] | null`——输入原始 bash 命令,输出完整 spawn argv;返回 `null` 表示该实现不可用,调用方按无沙箱执行。平台解析(`resolveSandboxProvider(platform)`)与 profile 文本生成是独立纯函数,均可脱离真实平台测试。备选:把 profile 字符串上提到 runner(会让 runner 依赖 Seatbelt 语义,破坏抽象);或让 provider 接管整个 spawn(重复实现输出捕获、进程组 kill,风险大)。

### D3:只在 `bash-command-runner` 收口包装,审批流保持正交

`runBashCommand` 增加 `sandbox` 选项,有 spec 时包装 argv,其余逻辑零改动——timeout、abort、进程组 kill、输出捕获天然复用。`tool-risk-classifier` 完全不动:沙箱与审批是两条独立防线,审批决策的预览与结论不因沙箱改变。备选:沙箱生效时放宽高风险审批(拒绝),会同时改变两个安全机制,超出 v1 范围。

### D4:默认 `workspace-write` + 网络开启,三档位 + 追加可写路径

`tools.sandbox = { mode: 'off' | 'read-only' | 'workspace-write', network: boolean, extraWritablePaths: string[] }`,默认 `workspace-write`、`network: true`(用户确认)。默认可写集:realpath(cwd)、realpath(TMPDIR)、`/private/tmp`、`~/.echo/agent-memory`、`/dev/null`,外加 `extraWritablePaths`(逐个 realpath)。文件读取全盘放行——只把"写"与"网"作为边界,否则 npm/git/编译链全跑不动。read-only 档可写集去掉 cwd 且恒禁网。备选:默认 off(更保守,但 ROADMAP 目标是默认获得防护);默认禁网(与"网络开启"的确认结论相悖)。

### D5:profile 基线为 `deny default` + 定向 allow,宽进严出迭代收紧

baseline allow:`process*`、`sysctl-read`、`mach-lookup`、`ipc-posix-shm`、`ipc-posix-sem`、`file-read*`、可写集上的 `file-write*`;network 开启时追加 `network*` + `system-socket`。profile 按 policy + realpath 路径集合在每次命令执行时生成并做 scheme 转义;生成成本可忽略,不引入缓存状态。v1 优先保证工具链可用性,牺牲部分最小权限;与现有 spec"不宣称完整 shell sandbox"的措辞一致,定位为加固层。备选:枚举 mach-lookup 白名单(初期会造成大量难以归因的失败,迭代成本高)。

### D6:`executionMode` 穿线到 registry,headless full-access 豁免沙箱

`prepareAgent` / `createDefaultToolRegistry` 增加 `executionMode` 参数,由 agent loop runtime 与 subagent runtime 传入;未显式传入的调用方(如 BTW port)默认按 interactive 处理。`headless + full-access` 强制关闭沙箱(与 full-access 放开授权的语义一致);`headless + deny` 下沙箱照常生效,这也是沙箱价值最大的场景。备选:在 one-shot 组合根覆盖配置快照——会污染用户配置语义,且 one-shot 并不解析 `LlmConfig`。

### D7:不可用即显式降级,fail-open 但可观测

`sandbox-exec` 缺失或平台不支持时按无沙箱执行,`/status` 展示不可用状态,不中断命令执行。理由:沙箱定位是审批流之外的纵深,审批流仍是主防线;fail-closed 会让没有 sandbox-exec 的环境完全不可用。备选:`onUnavailable: 'fail'` 配置项——v1 不增加配置面,需要时再加。

### D8:沙箱生效时在 transient 上下文追加一行说明

内置上下文prepend 已有 transient 环境说明机制,追加如"bash 命令在沙箱内执行:工作区外写入被拒绝、网络状态为 X;命令失败时考虑该因素"。让模型在命令被拒时能自行降级,而不是反复重试。该说明不进入 transcript 记录。

## Risks / Trade-offs

- [Risk] `sandbox-exec` 被标记 deprecated,未来 macOS 可能移除 → Mitigation:启动期可用性探测 + 显式降级 + `/status` 可见;provider 抽象保证可平滑替换为其他 macOS 沙箱方案或 Linux 方案。
- [Risk] profile 宽松(mach-lookup 全开、file-read* 全放行)被质疑为弱隔离 → Mitigation:文档与 `/status` 明确"加固层、非安全边界",与 high-risk-tool-approval spec 的既有措辞一致;D5 预留迭代收紧路径。
- [Risk] 默认开启后,写工作区外的既有命令(全局安装、写 `$HOME`)从成功变为失败,用户感知为"工具坏了" → Mitigation:proposal 已声明 BREAKING;`extraWritablePaths` 与 `mode: 'off'` 提供逃生口;transient 上下文让模型对失败有预期;`/status` 可确认当前档位。
- [Risk] 沙箱拒绝表现为非零退出/信号,难以归因 → Mitigation:transient 上下文说明;命令输出本身可见;denial 日志通道留待后续迭代。
- [Risk] darwin 上默认开启使既有 bash 相关测试进入沙箱执行,行为漂移 → Mitigation:测试 fixture 显式补 `tools.sandbox` 配置;需要真实沙箱行为的集成测试以 `darwin + sandbox-exec 存在` 为前提,其余平台 skip。
- [Risk] 包装后进程组 kill 的行为变化(sandbox-exec 成为组首) → Mitigation:runner 的 `detached` + `kill(-pid)` 语义不变,信号送达整组;集成测试覆盖 Esc 中断场景。

## Migration Plan

无存量数据迁移。发布顺序:实现 + 全量验证(`npm run typecheck` → `npm test` → `node --check`)→ macOS 手动验证(agent bash、Esc 中断、`/status`、`--once`、agent-memory skill 可写)→ 合入 `dev`。用户侧无操作要求;默认行为变化的回滚路径是 `~/.echo/config.json` 中 `tools.sandbox.mode: 'off'`,代码级回滚为 revert 对应提交。

## Open Questions

- 是否需要基于 `(debug deny)` 的 denial 调试通道(输出到 debug 日志)以辅助 profile 收紧迭代?
- `read-only` 档在 v1 是否需要暴露给 UI 快速切换(如 `/mode`),还是仅作为配置项存在?
- 后续是否允许审批决策影响沙箱(如对已批准命令临时放行网络)?
