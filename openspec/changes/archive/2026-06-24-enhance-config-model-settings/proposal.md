## Why

当前 `/config` 只能编辑 provider 连接和模型 API id，无法在 UI 中维护自定义 headers 和模型 context window；用户仍需手写 JSON。与此同时，配置面板仍混有 `add`、`save changes`、`not set` 等非技术英文文案，与项目已经确立的中文 command surface 语言不一致。

## What Changes

- 将 `/config` 扩展为 provider 列表、provider 详情、header 管理和 model 详情的分层交互，避免继续把模型配置挤在单层表单中。
- 支持新增、编辑和删除 provider 自定义 header；header value 默认脱敏，并继续与 preset 内置 headers 合并。
- 支持为每个模型配置显式 context window，允许清空显式值后恢复内置模型映射或默认窗口。
- `/config` 不展示或编辑 reasoning effort 和 reasoning summary；这些 API 深层概念继续由现有专用入口或手写配置管理。
- 让 `/config` 草稿读取、规范化和保存完整 round-trip `headers`、`contextWindow` 以及已有但不展示的 reasoning 配置，避免仅打开并保存面板时丢失手写字段。
- 将 command surface 中动作、状态、说明和普通字段标签等非技术英文文案改为中文；按键名、命令名、路径、协议名、模型 id、API 字段名和产品名继续保留英文。
- 为删除 provider、model 和 header、设置默认模型、保存等关键动作提供显式可聚焦行；已有快捷键可以保留，但不得成为唯一入口。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `interactive-llm-config-command`: 扩展 `/config` 的 provider/header/model 分层编辑、context window、脱敏、校验和配置无损持久化要求。
- `command-surface-ui-language`: 收紧用户可见文案的中文化要求，明确内置动作、状态、说明和非技术标签不得继续使用英文。

## Impact

- 主要影响 `src/commands/config/`、`src/render/footer/config-surface.ts`、`src/types/command.ts`、`src/config/llm-config-editor.ts` 及其测试。
- `/effort` 继续作为修改当前模型 effort 的专用入口；`/config` 不复制其交互，也不提供 summary 配置。
- 保存 `/config` 时需要隐藏保留已有 reasoning 对象，保持运行时 adapter 与配置 schema 不变。
- 不引入第三方 TUI 库，不切换 alternate screen，不改变 transcript、agent loop 或 tool approval 语义。
