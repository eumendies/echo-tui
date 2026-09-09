## Why

沙箱机制目前仅覆盖 macOS(Seatbelt):Linux 用户执行 `run_bash_command` 时没有任何沙箱包装,缺少审批流之外的防御纵深。`src/sandbox/` 的 provider 抽象已预留跨平台扩展点,按平台新增 provider 即可接入,成本可控。

## What Changes

- 新增 Linux bubblewrap 沙箱 provider(`src/sandbox/linux-bubblewrap.ts`):把 `(shell -lc command)` 包装为 `bwrap` argv;读取全盘放行(`--ro-bind / /`),写入限定为工作区、进程 TMPDIR、`/tmp`、`~/.echo/agent-memory` 与用户追加目录,网络关闭时以 `--unshare-net` 禁网;`read-only` 档恒禁网且不开放工作区写入
- bubblewrap 可用性探测除二进制发现(`/usr/bin/bwrap` 与 `PATH` 扫描)外,还须进行试运行探测并缓存结果,以识别"二进制存在但无法建立沙箱"的环境(Ubuntu 23.10+/24.04 AppArmor user namespace 限制、容器内 seccomp 阻断 unshare 等),探测失败按不可用显式降级、不静默
- `resolveSandboxProvider` 增加平台分支:Linux 解析为 bubblewrap provider,其他平台维持无 provider
- `/status` 沙箱降级原因按 provider 实现区分展示,替换当前硬编码的 `sandbox-exec 不可用` 文案
- 新增 bubblewrap 执行与 provider 解析测试,更新架构文档与 ROADMAP;策略配置(`tools.sandbox`)、`/config` 沙箱 Tab、bash 执行链路(timeout、Esc 中断、输出截断与 offload)不变

## Capabilities

### New Capabilities

<!-- 无新增 capability;Linux 沙箱是既有 bash-sandbox capability 的平台扩展 -->

### Modified Capabilities

- `bash-sandbox`:平台解析要求从"macOS 之外解析为无 provider"调整为"Linux 解析为 bubblewrap provider";新增 Linux bubblewrap 执行包装要求(可写与网络边界对齐既有策略语义、试运行可用性探测、执行语义不变);沙箱状态可观测要求补充 Linux 降级文案按 provider 区分

## Impact

- 代码:`src/sandbox/linux-bubblewrap.ts`(新增)、`src/sandbox/types.ts`(provider name 联合类型)、`src/sandbox/provider.ts`(平台分支)、`src/app/command/status-command-ports.ts`(降级文案)
- 测试:`test/sandbox/bubblewrap-execution.test.js`(新增,带环境跳过条件)、`test/sandbox/provider.test.js`(平台解析)
- 文档:`docs/tui-architecture.md`「Bash 沙箱」一节按平台分述并说明发行版差异、`ROADMAP.md`
- 依赖:不引入任何 npm 或构建期依赖;运行时依赖 Linux 系统包 `bubblewrap`(缺失或不可用时显式降级为无沙箱)
