## Why

当前 echo-tui 只提供基于 V4A/Begin Patch 与 unified diff 的 `apply_patch` 文件编辑方式，不同模型对该格式的生成稳定性存在差异。增加基于 `old_string`/`new_string` 精确替换的 `edit_file`，并允许用户在配置中心选择文件编辑工具，可以让用户按模型能力选择更可靠的编辑协议，同时继续获得一致的审批、回退和差异展示体验。

## What Changes

- 新增 provider-neutral 本地工具 `edit_file`，使用目标路径、`old_string` 与 `new_string` 对已有 UTF-8 文本文件执行精确 search-and-replace。
- `edit_file` 默认要求 `old_string` 唯一匹配；支持显式 `replace_all` 替换全部非重叠匹配，并对零匹配、多匹配、空搜索串、无效目标和无实际变化返回可恢复失败。
- 在 `~/.echo/config.json` 增加文件编辑工具模式，并在 `/config` 的“常规”Tab 中允许用户选择 `apply_patch` 或 `edit_file`；缺失或非法配置继续回退到 `apply_patch`。
- 默认工具 registry 每轮只向模型暴露用户选中的文件编辑工具，配置变化从下一次 assistant turn 开始生效。
- 将现有 `apply_patch` diff-style tool message renderer 泛化为共享文件编辑 renderer，使 `edit_file` 成功结果获得相同的按文件统计、行号 gutter、上下文折叠、红绿增删背景、宽度约束和展示预算。
- `edit_file` 接入现有 plan-mode 写入拒绝、交互审批、headless approval policy、change history、`/undo` 与非 Git `/diff` fallback。
- 保持历史 `apply_patch` transcript display metadata 可恢复和可渲染；不要求迁移已有 session。

## Capabilities

### New Capabilities

<!-- 无新增独立 capability；新工具行为归入现有本地工具执行能力。 -->

### Modified Capabilities

- `local-tool-execution`: 定义 `edit_file` 参数、精确替换、安全边界、结果 metadata，以及按配置选择默认文件编辑工具的行为。
- `config-surface-settings`: 增加文件编辑工具模式的读取、默认值、配置中心编辑、持久化和下一轮刷新语义。
- `high-risk-tool-approval`: 将 `edit_file` 纳入写入型工具审批和会话级授权。
- `tool-message-rendering`: 将 apply-patch 专属 diff 投影泛化并为 `edit_file` 提供同等结果渲染。
- `diff-command`: 非 Git fallback 同时覆盖 `apply_patch` 和 `edit_file` 的受控写入历史，并使用工具无关文案。
- `undo-command`: 将 `edit_file` 成功写入纳入 checkpoint、持久化和回退语义。
- `streaming-llm-service-adapter`: provider 请求只包含当前配置选中的文件编辑工具 schema，并能执行 `edit_file` tool call。

## Impact

- 配置与设置：`src/config/llm-config.ts`、`src/config/app-settings-config.ts`、`src/types/agent.ts`、`src/commands/config/`、`src/render/footer/config-surface.ts`。
- 工具执行与策略：新增 `src/tools/edit-file-tool-handler.ts` 或等价职责模块，并调整 tool registry、risk classifier、tool result 类型和 transcript details。
- 渲染与持久化：泛化 `src/render/tool-message-renderers/apply-patch.ts` 及其路由，扩展文件编辑 display metadata，同时兼容已有 `apply_patch` records。
- 历史能力：调整 `/diff` fallback 文案与测试；复用现有 `ChangeFileRecorder` 接入 `/undo`。
- Provider：所有 adapter 继续只转换 registry definitions，不直接实现编辑逻辑；不新增第三方依赖。
