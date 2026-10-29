# composer-file-picker-context Specification

## Purpose
定义 composer `@` 文件选择器、文件 mention 渲染、提交时文件上下文注入，以及 user 图片附件转换到 provider request 的外部行为。
## Requirements
### Requirement: @ 文件选择器触发与查询
系统 SHALL 仅在普通和计划 composer 输入态、没有更高优先级 surface 接管输入、用户独立键入非粘贴来源的 `@`、插入点位于文本开头或前一个 grapheme 是空白、且不在已确认引用内部时自动打开文件选择器。其他位置的 `@` SHALL 作为普通文本输入。文件选择器 SHALL 使用当前 composer 中从 `@` 开始的 trigger range 表示尚未确认的普通查询文本；用户在选择器打开期间继续输入的普通字符 SHALL 追加到该 range 并作为文件过滤 query。shell 和 shell-local 输入态 SHALL 将 `@` 作为普通字符处理。query 过滤 SHALL 保持有界，避免在大目录中因为搜索输出过大导致 file picker 空白或不可交互。

#### Scenario: 普通输入态打开文件选择器
- **WHEN** 普通输入态没有 active user question、tool approval、file picker、command session 或诊断 surface
- **AND** 用户在文本开头或空白后独立键入非粘贴来源的 `@`，且插入点不在已确认引用内部
- **THEN** 系统 SHALL 在 composer 中插入 `@`
- **THEN** 系统 SHALL 打开 file picker surface
- **THEN** file picker SHALL 记录该 `@` 的 trigger range

#### Scenario: @ 后续文本作为查询
- **WHEN** file picker 已打开
- **AND** 用户输入普通可打印字符
- **THEN** 系统 SHALL 将该字符追加到 composer 的 trigger range
- **THEN** file picker SHALL 使用 `@` 后的文本作为 query 过滤文件路径或当前可见文件项
- **THEN** 该过滤 SHALL 使用有界结果集，避免因为 cwd 后代文件过多而触发同步输出 buffer 溢出
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
- **THEN** composer SHALL 保留当前 `@query` 普通文本
- **THEN** 该查询 SHALL NOT 获得已确认引用资格、高亮或提交时的自动文件读取

#### Scenario: shell 模式不触发文件选择器
- **WHEN** 当前 interaction mode 是 shell 或 shell-local
- **AND** 用户输入 `@`
- **THEN** 系统 SHALL 将 `@` 作为普通 composer 字符插入
- **THEN** 系统 SHALL NOT 打开 file picker surface

#### Scenario: 邮箱版本号和无分隔中文不触发
- **WHEN** 用户输入 `user@example.com`、`pkg@version` 或 `请看@这里` 中的 `@`
- **THEN** 系统 SHALL 保持普通 composer 编辑，不打开 file picker
- **THEN** 相关文本 SHALL NOT 自动成为已确认引用

#### Scenario: bracketed paste 不触发选择器
- **WHEN** 用户通过 bracketed paste 粘贴包含 `@` 的内容，包括仅一个 `@` 的内容
- **THEN** 输入解析 SHALL 保留该文本来自粘贴的信息，即使 paste 标记或内容跨 stdin chunk 到达
- **THEN** 普通 composer SHALL 插入原始粘贴文本，不打开 file picker、不创建引用

#### Scenario: 选择器查询不是已确认引用
- **WHEN** file picker 已打开，用户输入或粘贴 query，且匹配到了实际存在的路径
- **AND** 用户尚未按 Enter 确认
- **THEN** trigger range SHALL 保持普通查询文本，不获得已确认引用高亮
- **THEN** Space 切换选择或鼠标操作 SHALL NOT 单独建立引用

### Requirement: 文件选择器浏览、多选和插入 mention
file picker SHALL 展示当前目录的直接子文件和子目录，支持目录进入/返回、当前项移动、多路径选择和确认插入。file picker SHALL 按需加载当前浏览目录的直接子项，而不是在打开时一次性扫描 cwd 下完整目录树。Space SHALL 切换当前可选择文件或目录的选中状态；Right SHALL 在目录上进入目录；Enter SHALL 只执行插入语义，在可选择文件或目录上插入当前路径或已选路径集合。Enter 成功确认时，系统 SHALL 原子替换 trigger range，并为每个插入的文件或目录创建一项已确认引用，记录实际路径及包含 `@` 与路径显示文本的 grapheme 半开范围；分隔空格 SHALL NOT 属于引用范围。Space、鼠标浏览/选择、query 匹配和路径实际存在 SHALL NOT 单独创建已确认引用。插入的 mention 序列后 SHALL 保留一个 trailing separating space，便于用户继续输入后续提示文本。

#### Scenario: 打开时懒加载 cwd 直接子项
- **WHEN** 用户在普通或计划 composer 输入态输入 `@` 打开 file picker
- **THEN** file picker SHALL 加载当前 cwd 的直接子文件和子目录
- **THEN** file picker SHALL NOT 为了渲染初始列表一次性扫描 cwd 下完整目录树
- **THEN** 即使 cwd 是包含大量后代文件的大目录，file picker SHALL 仍能显示可读取的直接子项

#### Scenario: 移动当前项
- **WHEN** file picker 已打开且 list focus 激活
- **AND** 用户按 Up 或 Down
- **THEN** file picker SHALL 在当前过滤结果中移动当前项
- **THEN** 当前项变化 SHALL 重置 preview 滚动位置

#### Scenario: 进入和返回目录
- **WHEN** file picker 当前项是目录
- **AND** 用户按 Right
- **THEN** file picker SHALL 进入该目录并按需加载该目录的直接子项
- **THEN** file picker SHALL 重置当前项、query 和 preview 滚动状态
- **WHEN** file picker list focus 激活
- **AND** 用户按 Left
- **THEN** file picker SHALL 返回父目录并展示父目录的直接子项

#### Scenario: Enter 插入目录而不进入目录
- **WHEN** file picker 当前项是目录
- **AND** 用户按 Enter
- **THEN** file picker SHALL NOT 进入该目录
- **THEN** 系统 SHALL 插入该目录的 `@path` mention 和一个尾随分隔空格
- **THEN** 系统 SHALL 关闭 file picker

#### Scenario: Space 多选可选择路径
- **WHEN** file picker 当前项是目录、文本、PDF 或受支持图片文件
- **AND** 用户按 Space
- **THEN** file picker SHALL 切换该路径的选中状态
- **THEN** file picker SHALL 保持打开并更新已选路径摘要

#### Scenario: Enter 插入已选路径 mention
- **WHEN** file picker 已打开且已选路径集合非空
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 使用全部已选路径的 `@path` mention 和一个尾随分隔空格替换当前 trigger range
- **THEN** 系统 SHALL 关闭 file picker
- **THEN** composer 光标 SHALL 位于插入内容之后
- **THEN** 每个已选路径 SHALL 对应独立的已确认引用范围，多项之间的空格 SHALL NOT 属于任何引用

#### Scenario: Enter 插入当前文件 mention
- **WHEN** file picker 已打开且已选文件集合为空
- **AND** 当前项是可选择文件
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 使用当前文件的 `@path` mention 和一个尾随分隔空格替换当前 trigger range
- **THEN** 系统 SHALL 关闭 file picker

#### Scenario: 不支持的文件不可选择
- **WHEN** file picker 当前项是暂不支持的文件类型
- **AND** 用户按 Space 或 Enter
- **THEN** file picker SHALL 保持打开
- **THEN** file picker SHALL 显示该文件类型暂不支持选择的说明

#### Scenario: 多路径 mention 保留空格路径
- **WHEN** 已选路径中包含空格
- **AND** 用户确认插入
- **THEN** 系统 SHALL 使用带双引号的 `@"path with spaces"` 形式插入该 mention
- **THEN** 系统 SHALL 使用空格分隔多个 mention

#### Scenario: query 过滤当前已加载目录
- **WHEN** file picker 已打开
- **AND** 用户在 `@` trigger 后输入 query
- **THEN** file picker SHALL 只过滤当前已加载目录的直接子项
- **THEN** file picker SHALL NOT 因 query 变化递归扫描后代目录

#### Scenario: 目录读取失败可见反馈
- **WHEN** file picker 打开或进入某个目录时无法读取该目录
- **THEN** file picker SHALL 保持可关闭
- **THEN** file picker SHALL 显示读取失败或目录不可读的说明

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
composer SHALL 仅根据草稿中的已确认引用范围，对 `@path` 和 `@"path with spaces"` 的显示文本使用强调色；外观相同但未确认的普通文本 SHALL NOT 高亮。高亮范围 SHALL 使用与 composer 一致的 grapheme cluster 下标，SHALL NOT 依赖空白结束或按文本重新解析路径。高亮 SHALL NOT 改变 composer 内部文本、光标位置、提交文本或输入历史，且 SHALL NOT 执行实时文件系统校验。

#### Scenario: 高亮普通文件 mention
- **WHEN** 用户在 file picker 中确认插入 `@src/app/main.ts`
- **THEN** composer surface SHALL 仅在该已确认引用范围内使用强调色
- **THEN** composer 内部字符数组 SHALL 保持原始未加 ANSI 的文本

#### Scenario: 高亮带引号文件 mention
- **WHEN** 用户在 file picker 中确认插入 `@"docs/my note.md"`
- **THEN** composer surface SHALL 使用强调色渲染完整已确认引用，包括 `@` 和双引号
- **THEN** 光标位置 SHALL 按原始字符宽度计算而不是按 ANSI 序列计算

#### Scenario: 高亮不做实时文件系统校验
- **WHEN** 草稿包含一项已确认引用
- **AND** 对应文件在确认后被删除或修改
- **THEN** renderer SHALL 继续按已确认范围高亮
- **THEN** renderer SHALL NOT 为每次渲染同步读取文件系统来校验路径是否存在

#### Scenario: 外观相同的普通文本不高亮
- **WHEN** 用户粘贴或通过纯文本恢复 `@src/app/main.ts` 或 `@"docs/my note.md"`
- **AND** 该文本没有已确认引用元数据，即使路径存在
- **THEN** composer SHALL 将其作为普通文本渲染

#### Scenario: 后续中文和标点不扩大范围
- **WHEN** 用户确认插入引用后删除尾随空格，并在引用末尾输入 `请检查，尤其这里`
- **THEN** 原引用 SHALL 继续高亮
- **THEN** 新增正文 SHALL NOT 被高亮或并入引用路径

#### Scenario: Unicode 和自动换行保持范围对齐
- **WHEN** 引用前后包含 emoji 或组合字符，或引用因终端宽度发生自动换行
- **THEN** 高亮范围与光标 SHALL 按实际 grapheme 数组和显示宽度保持对齐
- **THEN** resize 和重绘 SHALL NOT 改变引用资格或范围

### Requirement: 文件 mention 提交上下文
系统 SHALL 在提交普通用户消息前，仅使用该次提交独立快照中的已确认文件或目录引用读取上下文，并将支持的文件内容、目录直接子项或 user attachments 加入 provider-facing user text。系统 SHALL 直接使用确认时记录的路径，SHALL NOT 通过重新扫描原始输入或转换后的文本来发现额外引用；缺少已确认引用时 SHALL 保持纯文本提交，不因 `@` 文本自动读取文件或生成路径读取错误。可见 transcript SHALL 保留用户原始输入；provider-facing 文本 SHALL 包含路径上下文说明。provider-facing `@` 上下文 SHALL 只保留对模型有用的路径、文件内容、目录直接子项、图片已附件化说明和读取/支持错误信息，不包含 verbose `read_files` metadata。系统 SHALL 对重复 mention 去重读取，但不得修改用户可见文本。受支持图片超过最终附件大小上限但未超过源文件安全上限时，系统 SHALL 按归一化的 `tools.readFiles.autoCompressImages` 设置决定生成压缩附件或返回失败。

#### Scenario: 文本文件加入上下文
- **WHEN** 用户提交的快照包含已确认且可读取的文本文件引用
- **THEN** 系统 SHALL 读取该文本文件并将其内容加入 provider-facing user text
- **THEN** 可见 transcript SHALL 显示用户原始 composer 文本
- **THEN** provider-facing user text SHALL 包含该文件路径和文本内容
- **THEN** provider-facing user text SHALL NOT 包含 `read_files` 的类型、大小、编码、截断状态、读取耗时或等价执行 metadata

#### Scenario: 目录直接子项加入上下文
- **WHEN** 用户提交的快照包含已确认且可读取的目录引用
- **THEN** 系统 SHALL 将该目录的有界直接子项加入 provider-facing user text
- **THEN** 系统 SHALL NOT 递归读取目录后代或自动读取子文件内容
- **THEN** provider-facing user text SHALL 包含目录路径和直接子项的可复用路径、类型及可用文件大小
- **THEN** provider-facing user text SHALL NOT 把成功目录错误标记为 unavailable
- **THEN** 当目录还有更多子项时，provider-facing user text SHALL 包含简洁的省略提示

#### Scenario: PDF 文件加入上下文
- **WHEN** 用户提交的快照包含已确认且可读取的 PDF 引用
- **THEN** 系统 SHALL 提取 PDF 文字并将提取文本加入 provider-facing user text
- **THEN** 系统 SHALL NOT 对 PDF 执行 OCR 或页面渲染

#### Scenario: 未超限图片文件作为模型图片输入
- **WHEN** 用户提交的快照包含已确认、受支持且未超过最终附件大小上限的图片引用
- **THEN** 系统 SHALL 将该图片原始字节作为 provider-neutral user image attachment 附加到 user transcript record
- **THEN** provider-facing user text SHALL 说明该图片已作为附件提供
- **THEN** provider-facing user text SHALL 包含图片文件路径
- **THEN** provider-facing user text SHALL NOT 包含图片 base64 或原始二进制内容

#### Scenario: 自动压缩超限 mention 图片
- **WHEN** 用户提交的快照包含已确认且受支持的图片引用
- **AND** 图片超过最终附件大小上限但未超过源文件安全上限
- **AND** `tools.readFiles.autoCompressImages` 为 `true`
- **THEN** 系统 SHALL 在提交 user transcript record 前缩小并重新编码该图片
- **THEN** 系统 SHALL 只把不超过最终附件大小上限的压缩结果作为 user 图片附件
- **THEN** 附件 SHALL 保留原路径和媒体类型，并使用压缩结果的 Base64 与 size bytes
- **THEN** 可见 transcript SHALL 继续显示用户原始 composer 文本

#### Scenario: 关闭自动压缩时拒绝超限 mention 图片
- **WHEN** 用户提交的已确认图片引用超过最终附件大小上限
- **AND** `tools.readFiles.autoCompressImages` 为 `false`
- **THEN** provider-facing user text SHALL 包含该路径和图片超限说明
- **THEN** 系统 SHALL NOT 为该图片生成附件

#### Scenario: 不支持或读取失败路径明确反馈
- **WHEN** 用户提交的快照包含已确认但不支持、不可读取、不存在、超过源文件安全上限或无法安全压缩的路径引用
- **THEN** provider-facing user text SHALL 包含该路径的明确失败说明
- **THEN** provider-facing user text SHALL 包含失败路径和模型可理解的错误摘要
- **THEN** 系统 SHALL NOT 静默丢弃该 mention
- **THEN** 系统 SHALL NOT 为失败图片生成附件

#### Scenario: 重复 mention 去重读取
- **WHEN** 用户提交的快照包含同一路径的多项已确认引用
- **THEN** 系统 SHALL 最多读取和处理该路径一次
- **THEN** 可见 transcript SHALL 保留用户原始重复 mention 文本

#### Scenario: 普通 at 文本不触发读取或错误
- **WHEN** 用户提交邮箱、日志、代码、手写或粘贴的 `@path` 文本
- **AND** 提交快照不包含已确认引用
- **THEN** mention 展开 SHALL 保持原文，不读取相关路径、不生成图片附件或路径错误
- **THEN** 即使文本中的路径真实存在，系统 SHALL NOT 推断引用资格

#### Scenario: 已确认引用和同形普通文本并存
- **WHEN** 一条消息包含已确认的 `@src/app.ts` 和相同外观的未确认普通文本
- **THEN** 系统 SHALL 只根据已确认项的元数据读取路径
- **THEN** 未确认文本 SHALL NOT 增加引用、附带其他文件或扩大路径范围

#### Scenario: 命令转换不推断新引用
- **WHEN** 用户输入经 skill 或 workflow 转换为 provider-facing 文本
- **AND** 原草稿中包含已确认引用
- **THEN** 素材准备 SHALL 保留原草稿明确确认的路径集合，不把原始范围索引应用到转换后的文本
- **THEN** 命令模板、skill 内容或会话引用中的 `@` 文本 SHALL NOT 被扫描为额外文件引用

#### Scenario: 纯文本入口不继承当前草稿引用
- **WHEN** 命令直接提交一段文本或 headless prompt 包含 `@path`，但没有与之关联的已确认引用快照
- **THEN** 系统 SHALL NOT 通过该文本推断文件引用
- **THEN** 系统 SHALL NOT 借用 live composer 中其他草稿的已确认引用

#### Scenario: shell 和本地命令保持优先路由
- **WHEN** 含已确认引用元数据的草稿被切换为 shell/shell-local 提交，或提交被本地命令完整处理
- **THEN** 系统 SHALL 遵循原有 shell 或命令路由
- **THEN** 系统 SHALL NOT 因这些引用元数据额外执行 mention 文件展开

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


### Requirement: 已确认引用随文本编辑维护

composer SHALL 用与字符数组一致的 grapheme 半开范围和确认路径维护引用。普通文本插入、替换、退格、Delete、删词、删行和换行 SHALL 使用一致的范围更新规则。严格位于引用内部的插入或与引用任意部分相交的非空删除/替换 SHALL 撤销受影响引用；未删除的字符 SHALL 作为普通文本保留。范围外编辑 SHALL 按实际 grapheme 变化调整引用位置，而不是重新解析文本；恢复相同显示文本 SHALL NOT 自动重新确认引用。

#### Scenario: 引用前插入或删除文本
- **WHEN** 用户在已确认引用之前插入或删除中文、emoji、组合字符或换行，且不触及引用内容
- **THEN** 引用范围 SHALL 按实际编辑后的 grapheme 数组正确平移
- **THEN** 引用路径和确认资格 SHALL 保持不变

#### Scenario: 边界插入不扩展引用
- **WHEN** 用户在引用 `start` 处插入文本
- **THEN** 新文本 SHALL 位于引用之前，引用范围右移且不包含新文本
- **WHEN** 用户在引用 `end` 处插入文本
- **THEN** 新文本 SHALL 位于引用之后，引用范围不包含新文本

#### Scenario: 内部编辑降级为普通文本
- **WHEN** 用户在已确认引用内部插入字符，或用 Backspace、Delete、替换、删词或删行删除引用的任意部分
- **THEN** 受影响引用 SHALL 被撤销，其剩余文本 SHALL 保留为普通文本
- **THEN** 该文本 SHALL 不再高亮，也不再作为已确认引用参与提交读取
- **THEN** 之后编辑回原来的相同路径 SHALL NOT 自动恢复引用

#### Scenario: 跨多个引用的删除
- **WHEN** 一次删除或替换操作与多个引用的范围相交
- **THEN** 所有相交引用 SHALL 被撤销
- **THEN** 未相交引用 SHALL 按位置变化保留，SHALL NOT 被连带撤销或串用路径

#### Scenario: 删除分隔空格仍保留引用
- **WHEN** 用户仅删除已确认引用后的尾随分隔空格
- **THEN** 原引用范围及路径 SHALL 保持不变
- **THEN** 紧邻引用的后续正文 SHALL 保持普通文本

#### Scenario: 光标移动和普通整段赋值
- **WHEN** 用户仅移动光标而不编辑文本
- **THEN** 已确认引用 SHALL 保持不变
- **WHEN** composer 被 reset 或通过普通文本 setText 整段替换
- **THEN** 旧引用 SHALL 被清空，SHALL NOT 按新旧文本外观重新匹配

### Requirement: 引用快照贯穿提交与草稿隔离

系统 SHALL 在接受 composer 提交时、清空草稿之前捕获文本和已确认引用的独立快照，供普通提交、pending、steer 和恢复流程使用。快照 SHALL NOT 与后来 live composer 共享可变引用集合。文件读取时机、单槽容量、模式捕获、一次性交付和既有准备失败策略 SHALL 保持不变；未接受提交时 SHALL 保留草稿文本、光标和引用。

#### Scenario: 排队后编辑新草稿
- **WHEN** 含已确认引用的消息 A 被接收为 pending，用户随后编辑含不同引用的草稿 B
- **THEN** A SHALL 保存接收时的文本与引用，但在实际 dispatch 前不读取文件
- **THEN** A 实际发送时 SHALL 只读取 A 的已确认路径
- **THEN** B 的文本、光标和引用 SHALL NOT 被消费、修改或用于 A 的文件展开

#### Scenario: steer 异步准备隔离
- **WHEN** 含已确认引用的引导消息 A 已被接受并开始准备，用户随后编辑草稿 B
- **THEN** A 的准备 SHALL 只使用接收时的引用快照
- **THEN** 准备后的 record 被当前 turn 消费或移交下一轮时 SHALL NOT 再次读取文件
- **THEN** 旧条目的迟到完成 SHALL NOT 复活已移除的消息或污染 B

#### Scenario: 提交未被接受
- **WHEN** 单槽已占用、更高优先级流程接管或既有 response lock 规则阻止提交
- **THEN** 当前草稿文本、光标和引用 SHALL 保持不变
- **THEN** 系统 SHALL NOT 提前消费引用或重复记录输入历史

#### Scenario: 准备取消后恢复草稿
- **WHEN** 空闲提交在会话引用准备失败或取消后，既有恢复规则允许恢复且 live composer 仍为空
- **THEN** 系统 SHALL 恢复已消费快照中的原始文本和引用资格
- **THEN** 恢复后的同一引用 SHALL 再次高亮并可在后续提交中使用

#### Scenario: 准备失败不覆盖新草稿
- **WHEN** 已消费消息的异步准备失败或取消，且用户已经输入新草稿
- **THEN** 系统 SHALL 遵循原有失败反馈策略
- **THEN** 新草稿的文本、光标和引用 SHALL 全部保持不变

### Requirement: 输入历史按来源恢复引用资格

系统 SHALL 为当前会话中新接收的输入历史保存文本和引用快照，并按历史条目恢复已确认引用；仅有字符串的历史、粘贴和旧会话文本 SHALL NOT 被重新解析为引用。历史中的引用状态 SHALL 与 live composer 独立，后续编辑或 reset SHALL NOT 修改历史条目的原快照。该规则 SHALL NOT 要求新增跨重启引用元数据持久化，也 SHALL NOT 改变既有已提交 transcript 内容和附件重放语义。

#### Scenario: 当前会话历史恢复已确认引用
- **WHEN** 用户使用历史浏览恢复一条在当前会话提交且保存了引用快照的输入
- **THEN** 文本和引用 SHALL 一起恢复，引用可重新高亮并参与下一次显式提交
- **THEN** 文件 SHALL 在下一次真正发送时按现有规则读取，不复用旧文件内容快照

#### Scenario: 相同文本不同确认状态
- **WHEN** 两条输入历史的文本相同，但只有其中一条由 file picker 确认过引用
- **THEN** 恢复每条历史时 SHALL 使用各自快照的引用资格
- **THEN** 系统 SHALL NOT 通过文本匹配给未确认条目补上引用

#### Scenario: 旧纯文本历史不推断引用
- **WHEN** 系统恢复只有文本的旧历史或会话内容，其中包含 `@path`
- **THEN** 恢复到 composer 的文本 SHALL 不具有已确认引用资格
- **THEN** 系统 SHALL NOT 为恢复或后续纯文本重提自动读取该路径
- **THEN** 已提交记录原本携带的文件上下文与图片附件 SHALL 继续遵循原有持久化重放语义
