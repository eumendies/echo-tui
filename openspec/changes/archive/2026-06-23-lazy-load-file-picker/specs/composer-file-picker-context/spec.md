## MODIFIED Requirements

### Requirement: 文件选择器浏览、多选和插入 mention
file picker SHALL 展示当前目录的直接子文件和子目录，支持目录进入/返回、当前项移动、多文件选择和确认插入。file picker SHALL 按需加载当前浏览目录的直接子项，而不是在打开时一次性扫描 cwd 下完整目录树。Space SHALL 切换当前可选择文件的选中状态；Enter SHALL 在目录上进入目录，在可选择文件上插入当前文件或已选文件集合。插入的文件 mention 序列后 SHALL 保留一个 trailing separating space，便于用户继续输入后续提示文本。

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
- **AND** 用户按 Enter 或 Right
- **THEN** file picker SHALL 进入该目录并按需加载该目录的直接子项
- **THEN** file picker SHALL 重置当前项、query 和 preview 滚动状态
- **WHEN** file picker list focus 激活
- **AND** 用户按 Left
- **THEN** file picker SHALL 返回父目录并展示父目录的直接子项

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

#### Scenario: 目录读取失败可见反馈
- **WHEN** file picker 打开或进入某个目录时无法读取该目录
- **THEN** file picker SHALL 保持 surface 可见
- **THEN** file picker SHALL 显示读取失败或目录不可读的说明
- **THEN** file picker SHALL NOT 静默显示为空白列表

### Requirement: @ 文件选择器触发与查询
系统 SHALL 在普通和计划 composer 输入态支持通过输入 `@` 打开文件选择器。文件选择器 SHALL 使用当前 composer 中从 `@` 开始的 trigger range 表示查询文本；用户在选择器打开期间继续输入的普通字符 SHALL 追加到该 range 并作为文件过滤 query。shell 和 shell-local 输入态 SHALL 将 `@` 作为普通字符处理。query 过滤 SHALL 保持有界，避免在大目录中因为搜索输出过大导致 file picker 空白或不可交互。

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
- **THEN** composer SHALL 保留当前 `@query` 文本

#### Scenario: shell 模式不触发文件选择器
- **WHEN** 当前 interaction mode 是 shell 或 shell-local
- **AND** 用户输入 `@`
- **THEN** 系统 SHALL 将 `@` 作为普通 composer 字符插入
- **THEN** 系统 SHALL NOT 打开 file picker surface
