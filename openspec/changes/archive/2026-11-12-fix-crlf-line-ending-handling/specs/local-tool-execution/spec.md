## ADDED Requirements

### Requirement: 文件编辑工具的行尾兼容
`apply_patch` 与 `edit_file` SHALL 让行尾分隔符不影响编辑结果。系统 SHALL 把「精确匹配」定义为在剥离行尾分隔符之后的行内容上精确匹配，而不是在原始字节上匹配；行尾风格差异 SHALL NOT 导致匹配失败。

写回时系统 SHALL 保留目标文件原有的行尾风格：修改后的文件 SHALL 继续使用该文件编辑前的主流行尾分隔符，未修改行的字节 SHALL 保持不变。系统 SHALL NOT 把 CRLF 文件整体转换为 LF，也 SHALL NOT 把 LF 文件整体转换为 CRLF。

该兼容性 SHALL 只改变行尾处理，不改变既有匹配顺序、搜索游标推进、唯一性判定、写入安全边界或审批语义。

#### Scenario: CRLF 文件应用含 context 行的 update hunk
- **WHEN** 目标文件各行用 `CRLF` 分隔，且 `apply_patch` 收到与文件行内容一致、行尾为 `LF` 的 update hunk
- **THEN** handler SHALL 定位到该 hunk 并应用修改
- **THEN** result SHALL 标记 `ok: true`
- **THEN** handler SHALL NOT 返回「匹配 0 处」类错误

#### Scenario: 同一 hunk 在 LF 与 CRLF 文件上产生一致结果
- **WHEN** 两个目标文件的行内容完全相同，仅行尾分隔符分别为 `LF` 与 `CRLF`
- **AND** 两者收到同一份 update patch
- **THEN** 两个文件的修改后行内容 SHALL 相同
- **THEN** 两者的成功或失败结论 SHALL 相同

#### Scenario: 写回保留 CRLF 行尾
- **WHEN** `apply_patch` 成功更新一个 `CRLF` 文件
- **THEN** 写入内容 SHALL 使用 `CRLF` 作为行尾分隔符
- **THEN** 未被该 patch 触及的行 SHALL 保持原有字节序列
- **THEN** 文件 SHALL NOT 被转换为 `LF` 行尾

#### Scenario: 写回保留 LF 行尾
- **WHEN** `apply_patch` 成功更新一个 `LF` 文件
- **THEN** 写入内容 SHALL 继续使用 `LF` 作为行尾分隔符
- **THEN** 文件 SHALL NOT 被转换为 `CRLF` 行尾

#### Scenario: edit_file 在 CRLF 文件上匹配 LF 形式的 old_string
- **WHEN** 目标文件各行用 `CRLF` 分隔，且 `old_string` 使用 `LF` 换行
- **AND** `old_string` 在剥离行尾分隔符后与文件中某一区间完全一致
- **THEN** handler SHALL 按唯一匹配替换该区间
- **THEN** 写入后的 `new_string` 内容 SHALL 使用目标文件的 `CRLF` 行尾
- **THEN** result SHALL 报告实际替换数量

#### Scenario: edit_file 在 CRLF 文件上执行 replace_all
- **WHEN** `replace_all` 为 true，且 `old_string` 在 `CRLF` 文件中归一化后匹配多处
- **THEN** handler SHALL 替换全部非重叠匹配
- **THEN** 写入内容 SHALL 使用目标文件的 `CRLF` 行尾

#### Scenario: new_string 自带 CRLF 时不产生重复回车
- **WHEN** `new_string` 本身已包含 `CRLF` 换行，且目标文件行尾为 `CRLF`
- **THEN** 写入内容 SHALL NOT 出现连续两个 `CR` 字节
- **THEN** handler SHALL 先把 `new_string` 的行尾归一化，再转换为目标文件的行尾风格
- **THEN** 归一化后的替换文本 SHALL 作为 display metadata 的比对基准

#### Scenario: 归一化后无实际变化时拒绝写入
- **WHEN** `old_string` 与 `new_string` 在行尾归一化后内容相同，仅行尾风格不同
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL NOT 修改目标文件或产生成功 change-history entry

#### Scenario: 混合行尾文件逐行保留未修改行
- **WHEN** 目标文件同时包含 `CRLF` 与 `LF` 行尾
- **THEN** handler SHALL NOT 因行尾混合而拒绝编辑
- **THEN** 未被编辑触及的行 SHALL 保留各自原有的行尾分隔符
- **THEN** 新增或替换的行 SHALL 使用该文件的主流行尾分隔符
- **THEN** 未命中区域的文件内容 SHALL 保持不变

#### Scenario: 新增行使用主流行尾
- **WHEN** 目标文件中 `CRLF` 与独立 `LF` 的出现次数不同
- **THEN** 由本次编辑新增的行 SHALL 使用出现次数更多的行尾分隔符
- **THEN** handler SHALL NOT 按插入点相邻行的行尾推断新行分隔符

#### Scenario: hunk 内的 context 行保留原行尾
- **WHEN** 目标文件混合使用 `LF` 与 `CRLF`，且 update hunk 只修改其中一行、其余行作为 context
- **THEN** 未被修改的 context 行 SHALL 保留各自原有的行尾分隔符
- **THEN** handler SHALL NOT 因为整段替换 hunk 而给 context 行赋予主流行尾

#### Scenario: apply_patch 保持文件末尾换行状态
- **WHEN** `apply_patch` 的 hunk 触及文件末尾区域
- **THEN** 原文件末尾有换行符时，写入内容 SHALL 继续以换行符结尾
- **THEN** 原文件末尾无换行符时，写入内容 SHALL NOT 自动追加末尾换行符
- **THEN** 替换区间末尾为 context 行时，行尾状态 SHALL 由该 context 行原有的分隔符决定

#### Scenario: edit_file 的尾换行由替换文本决定
- **WHEN** `edit_file` 的匹配区间覆盖到文件末尾
- **THEN** 写入内容的尾换行状态 SHALL 由 `old_string` 与 `new_string` 的归一化后内容决定
- **THEN** handler SHALL NOT 额外自动增删末尾换行符
- **THEN** 显式删除末尾换行的替换 SHALL 生效，显式添加末尾换行的替换 SHALL 生效

#### Scenario: 无换行文件使用 LF 作为默认行尾
- **WHEN** 目标文件不包含任何换行符，且编辑引入了新行
- **THEN** 写入内容 SHALL 使用 `LF` 作为行尾分隔符

#### Scenario: 含裸 CR 的文件被明确拒绝
- **WHEN** 目标文件包含不构成 `CRLF` 的 `CR` 字节，包括整份文件只用 `CR` 换行的情形
- **THEN** `apply_patch` 与 `edit_file` SHALL 返回 `ok: false`
- **THEN** 失败原因 SHALL 指出目标文件包含裸 `CR` 行尾且当前不受支持
- **THEN** 失败提示 SHALL NOT 要求模型重新读取文件
- **THEN** handler SHALL NOT 写入、创建或删除任何文件

#### Scenario: 裸 CR 拒绝覆盖删除操作
- **WHEN** `apply_patch` 的 `Delete File` 目标文件包含裸 `CR`
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL NOT 删除该文件
- **THEN** handler SHALL NOT 为该文件生成只含单行的 removed 展示行

#### Scenario: 展示行不携带行尾分隔符
- **WHEN** 文件编辑工具为 `CRLF` 文件生成 display metadata
- **THEN** 每个展示行的文本 SHALL NOT 包含 `CR` 或 `LF` 字符
- **THEN** `apply_patch` 的 delete file 展示行 SHALL 同样不包含行尾分隔符

#### Scenario: 行尾归一化不改变匹配失败时的既有语义
- **WHEN** 目标文件为 `LF` 或 `CRLF`，且补丁的 hunk 行内容确实不与文件中任何区间一致
- **THEN** handler SHALL 继续返回 `ok: false` 与「匹配 0 处」类原因
- **THEN** 匹配顺序、搜索游标推进与唯一性判定 SHALL 保持不变
