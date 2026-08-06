## Why

当前所有被风险分类为需要审批的工具调用都必须等待用户手动选择，频繁的安全确认会打断连续工作。新增可选的大模型自动预判能力，可以在保持现有风险分类和人工审批兜底的前提下，减少用户明确授权范围内的重复确认。

## What Changes

- 在用户配置中新增独立于 interaction mode 的工具审批模式：`manual` 保持现状，`auto` 在人工审批前调用指定模型进行一次自动判断。
- 对所有现有被 `classifyToolCallRisk` 判定为 `approval_required`、且未命中当前进程会话授权缓存的工具调用应用统一的 auto 判断，包括文件编辑、高风险 bash 和需要审批的 MCP tools。
- 自动判断使用最近固定数量的会话消息和当前 tool call 构造无工具、无 reasoning 的独立模型请求，并要求模型只返回 `yes` 或 `no`。
- 仅把规范化后精确等于 `yes` 的响应转换为本次 `allow_once`；`no`、非法输出、配置错误或 provider 失败均回退到现有人工审批 surface。
- 保留现有人工审批选项、反馈输入、按工具/命令会话授权以及允许当前会话全部工具的语义。
- 在 `/config` 的“常规”Tab 中新增审批模式设置；仅当草稿选择 `auto` 时动态显示审批模型设置，并只允许引用已有 LLM model profile。
- Headless `--once` 继续使用现有 deny-by-default 与显式 `--full-access` 策略，不等待自动判断后的人工输入。

## Capabilities

### New Capabilities
- `automatic-tool-approval`: 定义 auto 审批模式、审批模型上下文、严格 yes/no 协议、无 reasoning 请求以及失败后回退人工审批的行为。

### Modified Capabilities
- `tool-approval`: 将现有 approval-required 工具拦截扩展为可选的模型预判，并明确会话授权缓存优先于 auto 请求且现有人工 surface 保持不变。
- `high-risk-tool-approval`: 高风险 bash、`apply_patch` 和 `edit_file` 在 auto 模式下可先经过统一模型判断，而不改变现有风险分类结果。
- `mcp-tool-integration`: 需要审批的 MCP tool 在 auto 模式下进入相同的模型预判流程，显式 `approval: "never"` 仍直接执行。
- `config-surface-settings`: “常规”Tab 新增工具审批模式，并根据模式动态显示和保存审批模型 profile。

## Impact

- 配置读取与保存：`src/config/app-settings-config.ts` 及对应 `/config` command state、handler、surface 和类型。
- 审批编排：`src/app/state/tool-approval-context.ts`、`src/app/assistant-turn-runner.ts`、`src/app/main.ts` 与 agent callback 组合。
- 模型调用：新增轻量审批 reviewer，并复用现有 provider adapters 和 model profile 解析；reviewer 不装配工具 registry，以 `reasoningEffort: none` 统一关闭 reasoning/thinking 配置和 Codex encrypted reasoning。
- 风险分类器本身不改变 safe、approval-required、rejected 的判定规则；auto 仅插入在 approval-required 与现有人工审批之间。
- 需要扩展配置、审批 runtime、provider 请求和 config surface 的自动化测试；不新增第三方依赖或 TUI 框架。
