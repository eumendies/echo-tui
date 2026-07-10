## Why

当前 `/config` 新增 provider 时只能手动输入模型 API id。用户已经填写 API key 和 Base URL 后，仍需要离开 TUI 去查厂商可用模型，容易输错模型名，也无法快速验证 provider 连接参数是否可用。

## What Changes

- 在 `/config` provider 详情页的 `+ add model` 下方新增显式 `list models` 选项。
- 当当前 provider 已提交 API key 且连接参数满足 preset 要求时，用户可通过该选项调用厂商 models 接口获取可用模型列表。
- 模型列表在 `/config` footer command surface 内展示，用户可选择一个远端模型加入当前 provider 草稿。
- 获取失败时在配置面板内显示脱敏错误，不写 transcript、不启动 agent loop、不保存配置。
- 对不支持模型枚举的 provider 协议，界面应给出不可用说明，并继续保留手动 `+ add model` 路径。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `interactive-llm-config-command`: 扩展 `/config` provider 详情页模型管理行为，支持基于当前 provider 草稿调用厂商 models 接口并从结果中添加模型。

## Impact

- 影响 `/config` command handler、command runtime 异步事件处理、footer config surface 渲染和 command host config 能力。
- 需要新增 provider model listing 逻辑，复用 provider preset catalog 解析出的 `agentType`、API key、Base URL 和隐藏 headers。
- 需要覆盖 OpenAI Responses/OpenAI Chat compatible、Anthropic compatible、Xiaomi Mimo Token Plan 等 preset 的可用或不可用行为。
- 不引入第三方 TUI 库，不切换 alternate screen，不改变保存配置文件格式。
