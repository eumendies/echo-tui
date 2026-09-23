## Why

当前 `/agents` 把来源、状态、运行策略、工具、Skills、MCP 与描述压缩在同一列表行中，在常见的 80 列及更窄终端里会大量截断，用户难以快速识别 Agent、异常和当前生效策略。详情与表单也缺少清晰分区，关键操作容易被连续字段淹没，因此需要在不改变管理语义和安全边界的前提下重新组织信息层级。

## What Changes

- 将 Agent 范围列表改为精简的身份与状态行，并为当前选中项提供稳定的结构化摘要区域，完整展示 capability、model、effort、工具、Skills、MCP、description 或诊断。
- 为宽终端提供列表与摘要左右分栏布局，为窄终端提供上下堆叠布局；两种布局保持相同焦点、键位和字段可见性。
- 使用一致的短状态标记、中文展示标签、计数和异常提示，明确区分生效、被覆盖、无效、保留及未配置状态。
- 将详情、创建/编辑表单和内置策略表单按身份、运行策略、能力与权限、操作等语义分区；危险操作与普通字段分离。
- 保留现有 Tab、方向键、Enter、Esc、确认、字段编辑、Skills/Tools 多选及下一轮生效语义，不改变 Agent 存储格式、覆盖优先级或运行时快照边界。
- 增加不同终端宽高、长文本、异常项、选中窗口和表单分区的渲染测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agents-command`: 调整 `/agents` 列表、选中项摘要、响应式布局、状态表达及详情/表单分区的可见行为，同时保持既有管理交互与持久化语义。

## Impact

- 主要影响 `src/commands/agents-command-handler.ts`、`src/types/command.ts` 与 `src/render/footer/agents-surface.ts`。
- 可能复用或扩展 `src/render/footer/config-panel-rows.ts` 中的分区、双列、动作行和窗口渲染原语，以减少配置类面板的视觉漂移。
- 需要更新 `test/commands/agents-command-handler.test.js`、`test/render/agents-surface.test.js` 以及 `openspec/specs/agents-command/spec.md` 对应的行为契约。
- 不新增第三方依赖，不改变命令端口、磁盘格式、Subagent 执行策略或 alternate-screen 约束。
