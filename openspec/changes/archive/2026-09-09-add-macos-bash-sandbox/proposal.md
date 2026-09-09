## Why

Agent 通过 `run_bash_command` 拥有完整本地 shell 能力,目前只有风险模式识别与人工审批这一层"软防线":免于审批的命令仍可任意读写文件系统与访问网络,误判的命令在获批后也拥有无边界权限。ROADMAP 已将"基于 sandbox-exec 的沙箱机制"列为待办 Feature;macOS 自带的 `sandbox-exec`(Seatbelt)可以零第三方依赖地提供 OS 级防御纵深,是第一版沙箱的正确落点。

## What Changes

- 新增 `src/sandbox/` 模块:provider-neutral 的沙箱抽象(`SandboxPolicy` / `SandboxProvider` 协议与平台解析),内置 macOS Seatbelt 实现;平台差异全部收敛在 provider 后面,为后续接入 Linux/Windows 沙箱预留接口。
- `run_bash_command` 工具执行链路按配置自动用 `sandbox-exec -p <profile>` 包装 spawn argv;timeout、Esc 中断、进程组 kill、输出截断与 offload 语义保持不变。
- 新增沙箱档位 `off` / `read-only` / `workspace-write`,以及 `network` 开关与 `extraWritablePaths` 追加可写目录;**默认 `workspace-write` 且网络开启**(对用户确认的默认值)。
- 默认可写集:realpath 后的当前工作区、进程 TMPDIR、`/private/tmp`、`~/.echo/agent-memory`(内置 agent-memory 脚本写入路径)、`/dev/null`,外加用户配置的追加目录;文件读取全盘放行。
- 非 darwin 平台或 `/usr/bin/sandbox-exec` 不可用时,provider 返回不可用并自动退化为无沙箱执行;`/status` SHALL 展示当前沙箱状态,退化不静默。
- headless `--once --full-access` 强制关闭沙箱(与 full-access 放开授权的语义一致);headless 默认 `deny` 审批政策下沙箱照常生效。
- v1 明确排除:用户 shell 模式(`/mode shell`、`shell-local`)、lifecycle hooks、MCP server 进程、内置 Node 侧工具(如 `apply_patch`)不套沙箱;高风险 bash 审批流程(`tool-risk-classifier`)保持不变。
- 沙箱生效时在内置 transient 系统上下文中追加一行说明,让模型知晓写/网受限并自行降级。
- **BREAKING**(默认行为变化):macOS 上默认启用 workspace-write 后,写入工作区与临时目录之外的命令(全局安装、写 `$HOME` 等)会被沙箱拒绝;逃生口为 `tools.sandbox.extraWritablePaths` 或 `mode: 'off'`。

## Capabilities

### New Capabilities

- `bash-sandbox`: 沙箱配置解析、策略档位、provider 抽象与平台解析、macOS Seatbelt profile 生成、bash 工具执行的沙箱包装、可用性探测与降级、headless full-access 豁免,以及 agent transient 上下文中的沙箱提示。

### Modified Capabilities

- `status-command`: status surface 新增展示当前沙箱状态(档位、网络、实现标识或不可用原因)。
- `single-turn-cli-chat`: `--full-access` 的语义从"自动允许 approval-required 工具"扩展为同时禁用本次运行的沙箱包装。

## Impact

- **新增代码**:`src/sandbox/`(types、provider 解析、macOS seatbelt 实现)。
- **修改代码**:`src/types/agent.ts`(`ToolRuntimeConfig` 增加 sandbox 配置)、`src/config/llm-config.ts`(解析校验)、`src/tools/bash-command-runner.ts` 与 `bash-tool-handler.ts`(argv 包装)、`src/tools/tool-registry.ts`(沙箱上下文构建)、`src/agent/agent-setup.ts` 与 agent/subagent loop runtime(`executionMode` 穿线)、内置 transient 上下文、`/status` surface 与 snapshot、`docs/tui-architecture.md`、`ROADMAP.md`。
- **测试**:`test/sandbox/`(profile 纯函数与平台解析)、`test/config/llm-config.test.js`(解析默认值与非法值)、`test/tools/`、`test/cli/one-shot.test.js`;darwin 集成测试以 sandbox-exec 存在为前提,其他平台 skip。
- **依赖**:无新增第三方依赖;仅依赖 macOS 自带 `/usr/bin/sandbox-exec`。
