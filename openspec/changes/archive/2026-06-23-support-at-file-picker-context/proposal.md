## Why

用户在询问模型时经常需要引用当前项目中的具体文件。现有流程需要用户手动输入路径、等待模型再调用工具读取文件，操作链路长且容易出现模型未读取、路径输入错误或图片无法随用户消息直接发送的问题。

引入 composer 内的 `@` 文件选择能力，可以让用户在输入问题时快速选择项目文件，并在提交时稳定地把文本、PDF 文字内容和图片输入加入模型上下文。

## What Changes

- 在普通/计划 composer 输入态支持输入 `@` 打开文件选择器，并将 `@query` 作为文件过滤条件。
- 新增 footer file picker surface，使用现有 ANSI/raw mode/footer 渲染机制，不切换 alternate screen、不引入第三方 TUI 依赖。
- 文件选择器支持项目文件浏览、多选、已选文件摘要、文本预览上下滚动、目录进入/返回和 Esc 取消。
- 选择完成后，将当前 `@query` 替换为一个或多个 `@path` 文件 mention；composer 中的文件 mention 使用强调色显示。
- 提交用户消息时解析文件 mention，将可支持文件加入模型上下文：文本文件作为文本上下文，PDF 提取文字作为文本上下文，受支持图片作为模型图片输入。
- 不支持的非文本/非图片/非 PDF 文件在 picker 中显示无法预览且不可选择；提交时遇到不可读取或不支持文件应明确反馈而不是静默忽略。
- 不包含破坏性变更。

## Capabilities

### New Capabilities
- `composer-file-picker-context`: 定义 `@` 文件选择器、文件 mention、选择器预览/多选交互，以及提交时把文件内容或图片附件加入模型上下文的行为。

### Modified Capabilities
- `terminal-tui-prototype`: 普通 composer 渲染增加文件 mention 高亮，并在输入事件优先级中加入 `@` 文件选择器 transient surface。

## Impact

- 影响 `src/input/`、`src/app/`、`src/render/footer/`、`src/render/layout.ts`、`src/types/` 的 composer 输入、surface 状态与渲染投影。
- 影响 provider transcript converters，使 user record 能携带 provider-neutral 图片附件并转换为 OpenAI/Anthropic 图片输入。
- 复用或抽取现有 `read_files` 能力读取文本、PDF 和图片，避免重复实现文件读取安全边界。
- 需要新增/更新测试覆盖输入触发、picker 状态、mention 替换、提交上下文展开、图片附件转换和不可选文件行为。
