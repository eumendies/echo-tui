## Why

当前 plan mode 完全不暴露 `run_bash_command`，模型无法通过 `git status`、`git diff`、`git log` 等只读命令理解工作区变更，影响代码 review、变更分析和实现规划质量。

需要在保持 plan mode 不执行修改操作的前提下，补齐只读 workspace inspection 能力。

## What Changes

- plan mode 的只读工具 registry 将暴露受限版 `run_bash_command`。
- 受限版 bash 只允许明确的只读观察命令，重点覆盖 git 状态、diff、历史和路径查询。
- plan mode 下的 bash 不走高风险审批；不在 allowlist 内的命令直接返回失败 tool result，并提示需要退出 plan mode。
- 更新 plan mode system prompt，明确可以使用只读 bash inspection，但不能运行测试、构建、安装、提交、切换分支或其他可能产生副作用的命令。
- normal mode 的 bash tool、apply_patch、tool approval 行为保持不变。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `local-tool-execution`: 增加 plan mode 下受限只读 bash tool 的可用性、allowlist 和拒绝语义。
- `terminal-tui-prototype`: 调整 plan mode 的外部行为，允许只读 bash inspection 辅助探索和规划，同时继续禁止执行修改。

## Impact

- 影响 `src/tools/tool-registry.ts`：plan mode registry 需要注册受限 bash handler。
- 影响 `src/tools/bash-tool-handler.ts` 或新增相邻 helper：需要实现 plan-safe command 校验和拒绝结果格式。
- 影响 `src/agent/system-prompt.ts`：plan mode 约束说明需要同步更新。
- 影响测试：需要覆盖 plan mode registry、plan prompt、允许/拒绝命令、agent runtime 工具暴露行为。
