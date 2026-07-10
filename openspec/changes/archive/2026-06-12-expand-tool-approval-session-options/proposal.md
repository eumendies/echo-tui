## Why

当前工具权限审批只能对单次调用选择允许或拒绝，遇到同一轮任务内连续的 `apply_patch` 或高风险 bash 时会反复打断用户。需要增加会话级授权选项，让用户在明确承担风险时减少重复确认，同时保留对 bash 命令的更细粒度控制。

## What Changes

- 工具审批 choice surface 增加会话级允许选项，并把所有 allow 选项连续展示。
- 支持 `Allow all tools for this session`，在当前 CLI 进程会话内跳过后续所有需要审批的工具调用。
- 支持 `Allow <tool> for this session`，用于非 bash 工具时按 tool name 跳过当前会话内同名工具的后续审批。
- 对 `run_bash_command` 采用 `Allow this command for this session` 语义，只允许当前 command 文本在本会话内复用授权，不直接允许整个 bash 工具。
- 会话级授权不写入 transcript、session persistence 或用户配置；退出进程后失效。
- 保留 `Deny`、Esc 拒绝和 `Tell model what to do` 反馈语义。

## Capabilities

### New Capabilities

### Modified Capabilities
- `tool-approval`: 扩展工具授权 UI 和结构化授权决策，支持会话级 allow 选项。
- `high-risk-tool-approval`: 扩展高危工具审批选项，定义会话级授权和 bash command 级授权语义。
- `streaming-llm-service-adapter`: 扩展 agent loop runtime 的授权编排，要求识别新增会话级 allow decision 并保持 approval callback 作为授权边界。
- `interactive-choice-surface`: 明确 tool approval 使用 choice surface 时可以展示新增授权选项，并要求 allow 选项相邻排列。

## Impact

- 影响 `src/app/tool-approval-context.ts` 的审批选项构造、会话级授权缓存和 decision 映射。
- 影响 `src/agent/agent-loop-runtime.ts` 的 allowed decision 判断，保持风险分类后仍通过 approval callback 获取授权决策。
- 影响 `src/types/agent.ts` 的审批 decision 类型，可能需要补充 command 级 session grant 表达。
- 影响 app、agent runtime、footer rendering 和文档测试。
- 不引入新依赖，不改变 provider API，不改变 transcript 或持久化 schema。
