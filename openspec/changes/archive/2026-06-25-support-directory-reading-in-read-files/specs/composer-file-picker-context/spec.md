## MODIFIED Requirements

### Requirement: 文件选择器浏览、多选和插入 mention
file picker SHALL 展示当前目录的直接子文件和子目录，支持目录进入/返回、当前项移动、多路径选择和确认插入。file picker SHALL 按需加载当前浏览目录的直接子项，而不是在打开时一次性扫描 cwd 下完整目录树。Space SHALL 切换当前可选择文件或目录的选中状态；Right SHALL 在目录上进入目录；Enter SHALL 只执行插入语义，在可选择文件或目录上插入当前路径或已选路径集合。插入的 mention 序列后 SHALL 保留一个 trailing separating space，便于用户继续输入后续提示文本。

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

#### Scenario: Enter 插入当前文件 mention
- **WHEN** file picker 已打开且已选路径集合为空
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

### Requirement: 文件 mention 提交上下文
系统 SHALL 在提交普通用户消息前解析 composer 中的文件或目录 mention，并将支持的文件内容、目录直接子项或 user attachments 加入 provider-facing user text。可见 transcript SHALL 保留用户原始输入；provider-facing 文本 SHALL 包含路径上下文说明。provider-facing `@` 上下文 SHALL 只保留对模型有用的路径、文件内容、目录直接子项、图片已附件化说明和读取/支持错误信息，不包含 verbose `read_files` metadata。系统 SHALL 对重复 mention 去重读取，但不得修改用户可见文本。

#### Scenario: 文本文件加入上下文
- **WHEN** 用户提交的 composer 文本包含可读取文本文件 mention
- **THEN** 系统 SHALL 读取该文本文件并将其内容加入 provider-facing user text
- **THEN** 可见 transcript SHALL 显示用户原始 composer 文本
- **THEN** provider-facing user text SHALL 包含该文件路径和文本内容
- **THEN** provider-facing user text SHALL NOT 包含 `read_files` 的类型、大小、编码、截断状态、读取耗时或等价执行 metadata

#### Scenario: 目录直接子项加入上下文
- **WHEN** 用户提交的 composer 文本包含可读取目录 mention
- **THEN** 系统 SHALL 将该目录的有界直接子项加入 provider-facing user text
- **THEN** 系统 SHALL NOT 递归读取目录后代或自动读取子文件内容
- **THEN** provider-facing user text SHALL 包含目录路径和直接子项的可复用路径、类型及可用文件大小
- **THEN** provider-facing user text SHALL NOT 把成功目录错误标记为 unavailable
- **THEN** 当目录还有更多子项时，provider-facing user text SHALL 包含简洁的省略提示

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

#### Scenario: 不支持或读取失败路径明确反馈
- **WHEN** 用户提交的 composer 文本包含不支持、不可读取、不存在或超出限制的路径 mention
- **THEN** provider-facing user text SHALL 包含该路径的明确失败说明
- **THEN** provider-facing user text SHALL 包含失败路径和模型可理解的错误摘要
- **THEN** 系统 SHALL NOT 静默丢弃该 mention
- **THEN** 系统 SHALL NOT 为失败图片生成附件

#### Scenario: 重复 mention 去重读取
- **WHEN** 用户提交的 composer 文本多次引用同一路径
- **THEN** 系统 SHALL 最多读取该路径一次
- **THEN** 可见 transcript SHALL 保留用户原始重复 mention 文本
