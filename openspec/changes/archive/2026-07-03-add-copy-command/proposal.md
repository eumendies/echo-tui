## Why

当前用户通过终端鼠标选区复制消息时，会把用户消息渲染前缀、自动换行缩进或其他视觉装饰一起复制进去，导致复制结果不干净。新增 `/copy` 命令可以从 transcript 语义数据复制原始 user/assistant 消息，避免把终端渲染细节暴露给复制体验。

## What Changes

- 新增 `/copy` slash command，用于打开消息复制面板。
- 复制面板仅展示当前 transcript 中的 user 和 assistant 消息，隐藏工具、本地提示、错误、reasoning、shell 等其他记录类型。
- 复制面板采用类似 file picker 的两栏 footer surface：左侧为单行消息列表预览，右侧为当前聚焦消息全文预览。
- 支持键盘在消息列表中移动、使用 Space 多选 user/assistant 消息，并在 Enter 后复制选中消息原文到系统剪贴板。
- 复制成功或失败应给出用户可见反馈；不改变 transcript 渲染样式。

## Capabilities

### New Capabilities
- `copy-command`: 定义 `/copy` 命令的可复制消息范围、选择交互、复制格式、剪贴板行为和用户反馈。

### Modified Capabilities
- `command-host-runtime`: 扩展 CommandHost 受控能力，使 copy command handler 可以读取可复制 transcript 消息并写入剪贴板，而不直接访问完整 AppContext 或终端实现。
- `command-surface-ui-language`: 要求 copy surface 遵循现有 footer command surface 的焦点、marker、中文文案、高度预算和两栏布局视觉语言。

## Impact

- 影响 slash command 注册和帮助/建议列表，新增 `/copy` 命令描述。
- 影响 `CommandHost` 类型和实现，新增受控的 transcript 只读复制数据能力与 clipboard 写入能力。
- 新增 copy command handler、copy command surface 类型与 footer renderer。
- 新增跨平台剪贴板写入实现或封装，优先支持常见系统命令并处理不可用场景。
- 新增或更新命令 handler、surface renderer、clipboard 和 host 相关测试。
