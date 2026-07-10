## Context

当前 TUI 的 composer、slash suggestion、tool approval、用户问题等交互都通过 footer transient surface 呈现，输入事件在 app 层按优先级分发，渲染层不使用 alternate screen 或第三方 TUI 库。`read_files` 已经具备文本、受支持图片和 PDF 文字提取能力，provider converters 已支持从 tool result 图片附件投影为模型图片输入。

本变更要把“用户主动选择项目文件作为上下文”的流程前移到 composer 输入阶段：用户输入 `@` 打开文件选择器，选择文件后在 composer 中留下 `@path` mention，提交时系统自动读取这些 mention 并加入模型请求。

## Goals / Non-Goals

**Goals:**

- 在普通和计划输入态提供 `@` 文件选择器，支持 `@query` 过滤、文件浏览、多选和文本预览滚动。
- 选择文本、PDF 和受支持图片文件后，提交时将其作为模型上下文；图片必须作为真正的图片输入发送给模型。
- 在 composer 渲染中高亮 `@file` mention，让用户能区分普通文本和文件引用。
- 使用现有 footer renderer、ANSI 控制序列、raw mode 输入解析和本地文件读取边界。
- 非文本、非 PDF、非受支持图片文件在选择器中显示无法预览且不可选择。

**Non-Goals:**

- 不实现 slash 搜索模式；`@` 后续输入本身就是 query。
- 不实现图片终端预览、PDF 页面渲染、OCR 或二进制文件预览。
- 不把选择文件伪造成 assistant tool call/tool result。
- 不支持选择目录作为模型上下文；目录只用于浏览。
- 不实时校验 composer 中每个 mention 的存在性或类型，避免输入渲染路径频繁访问文件系统。

## Decisions

### 1. 使用独立 FilePickerContext，而不是复用 slash command runtime

`@` 文件选择器是 composer 编辑态的 inline interaction，不是提交后的 slash command。实现上应在 app 输入分发中加入独立 transient context，并让其优先于 slash suggestion 和普通 composer edit 消费事件。

替代方案是把 picker 做成 command session；这会把 `@` 编辑态行为误建模为 slash command，并要求 command runtime 理解 trigger range 和 composer 替换，职责不清。

### 2. `@query` 是唯一搜索入口

打开 picker 时记录 composer 中 `@` 的 trigger range。picker active 期间普通字符追加到该 range 并作为 query 过滤文件；Backspace 缩短 query，删除 `@` 后关闭 picker；Esc 关闭 picker 但保留当前 `@query` 原文。

不引入 `/` 搜索模式，避免同一 surface 内出现两套搜索状态，也避免和路径中的 `/` 产生歧义。

### 3. Space 多选，Enter 插入

Space 只切换当前可选择文件的选中状态，不插入空格。Enter 在目录上进入目录；在文件上，如果已有选中文件则插入全部已选文件，否则插入当前文件。插入时用一个或多个 `@path` 替换原 trigger range。

该设计同时覆盖快速单选和显式多选，并让选中文件集合在用户确认前始终可见。

### 4. Footer file picker surface 承载两栏 UI

新增 `file_picker` surface，由 footer renderer 在高度预算内渲染。左栏为文件/目录列表，右栏为 preview。顶部显示当前位置和已选文件摘要，底部显示按键提示。列表不显示文件大小。

文本 preview 支持上下滚动；PDF 和图片显示说明；其他不支持文件显示无法预览/不可选择说明。surface 必须遵循现有安全宽度和高度裁剪约束，不使用 alternate screen。

### 5. 提交时展开 mention，而不是把全文塞进 composer

composer 中只保存用户可编辑的 `@path` mention。用户提交时，系统解析 mention、去重读取文件，并构造 provider-facing user text。transcript 可见内容使用 `displayText` 保持原始输入，模型收到的 `text` 包含文件上下文说明和文本/PDF 内容。

这样避免输入框和历史记录被大段文件内容污染，同时保证模型第一轮响应能看到用户选择的文件。

### 6. User record 支持图片附件

受支持图片 mention 提交时生成 provider-neutral image attachments，挂在 user transcript record 上。OpenAI Responses、OpenAI Chat 和 Anthropic converters 需要把 user record 图片附件转换为对应 provider 的图片输入。

替代方案是伪造 `read_files` tool result 以复用现有图片附件路径；该方案会污染 transcript 语义，使历史记录看起来像模型主动调用了工具，因此不采用。

### 7. 复用 read_files 的读取边界

提交时读取文本、PDF 和图片应复用或抽取 `read_files` 的现有路径校验、媒体识别、大小限制、PDF 文字提取和图片附件生成逻辑。picker 浏览阶段只做轻量分类和预览，不完整读取大文件、不解析 PDF。

## Risks / Trade-offs

- [Risk] 文件索引或 preview 在大仓库中可能变慢 → 通过结果上限、目录窗口化、轻量类型判断和懒读取 preview 降低成本。
- [Risk] composer 高亮插入 ANSI 后影响光标坐标 → 渲染时宽度计算仍基于原始字符，ANSI 只包裹输出片段，并复用可见宽度 padding 工具。
- [Risk] 提交时文件已删除或类型变化 → 展开上下文时返回明确的文件失败块，不静默忽略。
- [Risk] 图片附件扩大 provider 请求体 → 复用现有图片大小限制，超过上限时返回明确失败，不生成不完整附件。
- [Risk] plan mode 中用户主动附加文件可能扩大上下文 → 允许只读读取并保持 plan mode 工具边界不变；文件加入上下文不执行写操作。
