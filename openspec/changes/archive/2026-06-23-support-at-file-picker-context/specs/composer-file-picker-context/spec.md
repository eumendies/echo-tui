## ADDED Requirements

### Requirement: @ 文件选择器触发与查询
系统 SHALL 在普通和计划 composer 输入态支持通过输入 `@` 打开文件选择器。文件选择器 SHALL 使用当前 composer 中从 `@` 开始的 trigger range 表示查询文本；用户在选择器打开期间继续输入的普通字符 SHALL 追加到该 range 并作为文件过滤 query。shell 和 shell-local 输入态 SHALL 将 `@` 作为普通字符处理。

#### Scenario: 普通输入态打开文件选择器
- **WHEN** 普通输入态没有 active user question、tool approval、file picker、command session 或诊断 surface
- **AND** 用户输入 `@`
- **THEN** 系统 SHALL 在 composer 中插入 `@`
- **THEN** 系统 SHALL 打开 file picker surface
- **THEN** file picker SHALL 记录该 `@` 的 trigger range

#### Scenario: @ 后续文本作为查询
- **WHEN** file picker 已打开
- **AND** 用户输入普通可打印字符
- **THEN** 系统 SHALL 将该字符追加到 composer 的 trigger range
- **THEN** file picker SHALL 使用 `@` 后的文本作为 query 过滤文件路径
- **THEN** 该输入 SHALL NOT 关闭 file picker

#### Scenario: Backspace 更新查询或关闭选择器
- **WHEN** file picker 已打开且 trigger range 中存在 query 字符
- **AND** 用户按 Backspace
- **THEN** 系统 SHALL 删除 query 的最后一个编辑单元并刷新过滤结果
- **WHEN** file picker 已打开且 trigger range 只剩 `@`
- **AND** 用户按 Backspace
- **THEN** 系统 SHALL 删除该 `@` 并关闭 file picker

#### Scenario: Esc 取消选择但保留文本
- **WHEN** file picker 已打开
- **AND** 用户按 Esc
- **THEN** 系统 SHALL 关闭 file picker
- **THEN** composer SHALL 保留当前 `@query` 文本

#### Scenario: shell 模式不触发文件选择器
- **WHEN** 当前 interaction mode 是 shell 或 shell-local
- **AND** 用户输入 `@`
- **THEN** 系统 SHALL 将 `@` 作为普通 composer 字符插入
- **THEN** 系统 SHALL NOT 打开 file picker surface

### Requirement: 文件选择器浏览、多选和插入 mention
file picker SHALL 展示当前项目文件，支持目录进入/返回、当前项移动、多文件选择和确认插入。Space SHALL 切换当前可选择文件的选中状态；Enter SHALL 在目录上进入目录，在可选择文件上插入当前文件或已选文件集合。插入的文件 mention 序列后 SHALL 保留一个 trailing separating space，便于用户继续输入后续提示文本。

#### Scenario: 移动当前项
- **WHEN** file picker 已打开且 list focus 激活
- **AND** 用户按 Up 或 Down
- **THEN** file picker SHALL 在当前过滤结果中移动当前项
- **THEN** 当前项变化 SHALL 重置 preview 滚动位置

#### Scenario: 进入和返回目录
- **WHEN** file picker 当前项是目录
- **AND** 用户按 Enter 或 Right
- **THEN** file picker SHALL 进入该目录并重置当前项、query 和 preview 滚动状态
- **WHEN** file picker list focus 激活
- **AND** 用户按 Left
- **THEN** file picker SHALL 返回父目录

#### Scenario: Space 多选可选择文件
- **WHEN** file picker 当前项是文本、PDF 或受支持图片文件
- **AND** 用户按 Space
- **THEN** file picker SHALL 切换该文件的选中状态
- **THEN** file picker SHALL 保持打开并更新已选文件摘要

#### Scenario: Enter 插入已选文件 mention
- **WHEN** file picker 已打开且已选文件集合非空
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 使用全部已选文件的 `@path` mention 和一个尾随分隔空格替换当前 trigger range
- **THEN** 系统 SHALL 关闭 file picker
- **THEN** composer 光标 SHALL 位于插入内容之后

#### Scenario: Enter 插入当前文件 mention
- **WHEN** file picker 已打开且已选文件集合为空
- **AND** 当前项是可选择文件
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 使用当前文件的 `@path` mention 和一个尾随分隔空格替换当前 trigger range
- **THEN** 系统 SHALL 关闭 file picker

#### Scenario: 不支持文件不可选择
- **WHEN** file picker 当前项是非文本、非 PDF、非受支持图片文件
- **AND** 用户按 Space 或 Enter
- **THEN** file picker SHALL NOT 将该文件加入已选文件集合
- **THEN** file picker SHALL 保持打开并显示该文件暂不支持选择的说明

### Requirement: 文件选择器预览与可见布局
file picker SHALL 使用 footer transient surface 呈现两栏布局。左栏 SHALL 展示文件和目录列表，右栏 SHALL 展示当前项 preview。列表 SHALL NOT 显示文件大小。surface SHALL 显示当前路径、已选文件摘要和操作提示，并 SHALL 遵循现有 footer 高度与安全宽度约束。

#### Scenario: 渲染两栏文件选择器
- **WHEN** file picker surface 可见
- **THEN** TUI SHALL 渲染包含当前路径、已选文件摘要、文件列表、preview 和操作提示的 footer surface
- **THEN** 文件列表 SHALL 不显示文件大小
- **THEN** 文件列表 SHALL 使用不同 marker 区分已选、可选未选和不可选文件

#### Scenario: 已选文件摘要
- **WHEN** file picker 已选择一个或多个文件
- **THEN** surface SHALL 显示已选文件数量
- **THEN** surface SHALL 显示能够放入当前宽度的已选文件路径摘要
- **THEN** 当已选路径无法完整显示时，surface SHALL 使用 `+N` 或等价方式提示剩余数量

#### Scenario: 文本文件 preview 支持滚动
- **WHEN** file picker 当前项是可预览文本文件
- **THEN** preview SHALL 显示文本文件名、文本类型信息和带行号的内容窗口
- **WHEN** preview focus 激活且用户按 Up 或 Down
- **THEN** preview SHALL 上下滚动内容窗口

#### Scenario: PDF preview 显示提交语义
- **WHEN** file picker 当前项是 PDF 文件
- **THEN** preview SHALL 显示该文件是 PDF
- **THEN** preview SHALL 说明提交时会提取 PDF 文字作为上下文
- **THEN** preview SHALL 说明不支持 OCR 或页面渲染

#### Scenario: 图片 preview 显示附件语义
- **WHEN** file picker 当前项是受支持图片文件
- **THEN** preview SHALL 显示图片无法在终端内预览
- **THEN** preview SHALL 说明选择后会作为图片输入发送给模型

#### Scenario: 其他非文本文件 preview 显示不可用
- **WHEN** file picker 当前项是不支持文件
- **THEN** preview SHALL 显示无法预览
- **THEN** preview SHALL 说明当前仅支持选择文本、PDF 和受支持图片文件

### Requirement: composer 文件 mention 高亮
composer SHALL 在渲染层对 `@path` 和 `@"path with spaces"` 文件 mention 使用强调色显示。高亮 SHALL NOT 改变 composer 内部文本、光标位置、提交文本或输入历史。

#### Scenario: 高亮普通文件 mention
- **WHEN** composer 文本包含 `@src/app/main.ts` 形式的文件 mention
- **THEN** composer surface SHALL 使用强调色渲染该 mention
- **THEN** composer 内部字符数组 SHALL 保持原始未加 ANSI 的文本

#### Scenario: 高亮带引号文件 mention
- **WHEN** composer 文本包含 `@"docs/my note.md"` 形式的文件 mention
- **THEN** composer surface SHALL 使用强调色渲染完整 mention
- **THEN** 光标位置 SHALL 按原始字符宽度计算而不是按 ANSI 序列计算

#### Scenario: 高亮不做实时文件系统校验
- **WHEN** composer 文本包含看起来像文件 mention 的文本
- **THEN** composer renderer SHALL 能高亮该文本
- **THEN** renderer SHALL NOT 为每次渲染同步读取文件系统来校验 mention 是否存在

### Requirement: 文件 mention 提交上下文
系统 SHALL 在提交普通用户消息前解析 composer 中的文件 mention，并将支持的文件内容加入 provider-facing user text 或 user attachments。可见 transcript SHALL 保留用户原始输入；provider-facing 文本 SHALL 包含文件上下文说明。provider-facing `@` 文件上下文 SHALL 只保留对模型有用的文件路径、文件内容、图片已附件化说明和读取/支持错误信息，不包含 verbose `read_files` metadata。系统 SHALL 对重复 mention 去重读取，但不得修改用户可见文本。

#### Scenario: 文本文件加入上下文
- **WHEN** 用户提交的 composer 文本包含可读取文本文件 mention
- **THEN** 系统 SHALL 读取该文本文件并将其内容加入 provider-facing user text
- **THEN** 可见 transcript SHALL 显示用户原始 composer 文本
- **THEN** provider-facing user text SHALL 包含该文件路径和文本内容
- **THEN** provider-facing user text SHALL NOT 包含 `read_files` 的类型、大小、编码、截断状态、读取耗时或等价执行 metadata

#### Scenario: PDF 文件加入上下文
- **WHEN** 用户提交的 composer 文本包含可读取 PDF mention
- **THEN** 系统 SHALL 提取 PDF 文字并将提取文本加入 provider-facing user text
- **THEN** 系统 SHALL NOT 对 PDF 执行 OCR 或页面渲染

#### Scenario: 图片文件作为模型图片输入
- **WHEN** 用户提交的 composer 文本包含受支持图片 mention
- **THEN** 系统 SHALL 将该图片作为 provider-neutral user image attachment 附加到 user transcript record
- **THEN** provider-facing user text SHALL 说明该图片已作为附件提供
- **THEN** provider-facing user text SHALL 包含图片文件路径
- **THEN** provider-facing user text SHALL NOT 包含图片 base64 或原始二进制内容

#### Scenario: 不支持或读取失败文件明确反馈
- **WHEN** 用户提交的 composer 文本包含不支持、不可读取、不存在或超出限制的文件 mention
- **THEN** provider-facing user text SHALL 包含该文件的明确失败说明
- **THEN** provider-facing user text SHALL 包含失败文件路径和模型可理解的错误摘要
- **THEN** 系统 SHALL NOT 静默丢弃该 mention
- **THEN** 系统 SHALL NOT 为失败图片生成附件

#### Scenario: 重复 mention 去重读取
- **WHEN** 用户提交的 composer 文本多次引用同一路径
- **THEN** 系统 SHALL 最多读取该路径一次
- **THEN** 可见 transcript SHALL 保留用户原始重复 mention 文本

### Requirement: user record 图片附件转换
系统 SHALL 支持 user transcript record 携带 provider-neutral 图片附件，并在 provider request 转换时把这些附件投影为对应模型 API 的图片输入。该能力 SHALL 独立于 tool result 图片附件，不要求伪造 tool call 或 tool result。

#### Scenario: OpenAI Responses 转换 user 图片附件
- **WHEN** user transcript record 包含一个或多个有效图片附件
- **AND** 系统构建 OpenAI Responses 请求
- **THEN** converter SHALL 将该 user message content 转换为包含 input_text 和 input_image 的内容块
- **THEN** input_image SHALL 使用对应图片附件的 data URL

#### Scenario: OpenAI Chat 转换 user 图片附件
- **WHEN** user transcript record 包含一个或多个有效图片附件
- **AND** 系统构建 OpenAI Chat 请求
- **THEN** converter SHALL 将该 user message content 转换为包含 text 和 image_url 的内容块

#### Scenario: Anthropic 转换 user 图片附件
- **WHEN** user transcript record 包含一个或多个有效图片附件
- **AND** 系统构建 Anthropic 请求
- **THEN** converter SHALL 将该 user message content 转换为包含 text 和 image block 的 user message

#### Scenario: 无图片附件保持原有文本转换
- **WHEN** user transcript record 不包含有效图片附件
- **THEN** provider converters SHALL 保持既有纯文本 user message 转换语义
