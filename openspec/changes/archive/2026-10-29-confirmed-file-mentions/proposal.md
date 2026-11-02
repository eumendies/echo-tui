## Why

当前 composer 将任意 `@` 后直到空白的文本识别为文件 mention，邮箱、日志、代码和中文描述容易被误高亮；提交时还会尝试读取这些误识别路径。需要让文件引用由用户在选择器中的明确确认建立，而不是从普通文本猜测。

## What Changes

- **BREAKING**：移除仅凭 `@path` 或 `@"path with spaces"` 文本自动建立文件引用的行为；路径存在也不例外。
- 文件选择器 Enter 确认时，同时插入现有文本外观和已确认引用元数据；多选、空格路径、目录和尾随空格保持兼容。
- 高亮和提交读取都使用同一组已确认引用；引用边界不再依赖空白，后续中文或标点不会被吞入路径。
- 仅普通/计划模式下、文本开头或空白后的独立键入 `@` 自动打开选择器；邮箱、版本号中的 `@` 和粘贴内容不触发。
- 编辑引用内部或删除其任意部分时撤销该引用资格，保留编辑后的普通文本；范围外编辑只调整位置。
- 提交、pending、steer、失败恢复和当前会话输入历史携带引用快照，与后续 live composer 草稿隔离。
- 历史纯文本、命令生成文本和 headless prompt 不因包含 `@` 而被自动附带为文件。

## Capabilities

### New Capabilities

无。复用既有文件选择器能力。

### Modified Capabilities

- `composer-file-picker-context`：将触发、高亮和提交改为显式确认引用，补充引用范围编辑、粘贴来源以及草稿/提交生命周期规则。

## Impact

- 输入：`src/input/composer.ts`、`src/input/file-mentions.ts`、输入事件及 bracketed paste 解析。
- 状态：composer 引用与输入历史快照、file picker 确认、pending/steer 引用快照。
- 编排：`src/app/input-event-controller.ts`、`src/app/composer-submission-controller.ts`、`src/app/utils.ts` 的显式引用传递和读取。
- 渲染：`src/render/layout.ts` 只消费引用范围，不解析普通文本、不实时校验文件系统。
- 测试与用户文档：覆盖误触发、引用编辑、Unicode 边界、提交隔离及手写 `@path` 的行为变化。
- 不增加依赖，不改变 ANSI/raw mode、不使用 alternate screen；不修改 provider 附件协议、文件读取上限和审批策略，也不新增持久化草稿格式。
