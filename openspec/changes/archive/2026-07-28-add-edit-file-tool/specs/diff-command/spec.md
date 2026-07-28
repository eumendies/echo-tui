## MODIFIED Requirements

### Requirement: change history fallback 持久化受控编辑历史
系统 SHALL 为非 Git fallback 和 `/undo` 维护同一份可序列化 change history。change history SHALL 记录受控文件编辑工具成功写入文件所需的 before snapshot、写入状态、checkpoint 时间、transcript 边界、compaction 状态和 invalid boundary；受控工具 SHALL 包含 `apply_patch` 与 `edit_file`。该 history SHALL 随当前 transcript session 持久化，并在 `/resume` 加载 session 后恢复给 `/diff` 与 `/undo` 共用。

#### Scenario: apply_patch 成功写入进入 history
- **WHEN** assistant loop 中 `apply_patch` 成功写入一个已有文本文件
- **THEN** change history SHALL 记录该文件写入前的 snapshot 和 `updated` 状态
- **WHEN** assistant loop 中 `apply_patch` 成功新增一个文本文件
- **THEN** change history SHALL 记录该文件写入前不存在和 `created` 状态

#### Scenario: edit_file 成功写入进入 history
- **WHEN** assistant loop 中 `edit_file` 成功更新一个已有文本文件
- **THEN** change history SHALL 记录该文件写入前的 snapshot 和 `updated` 状态

#### Scenario: history 随 session 持久化
- **WHEN** 当前 session 中存在 change history entries
- **AND** transcript session 被保存
- **THEN** session 文件 SHALL 保存可序列化的 change history
- **WHEN** 用户通过 `/resume` 加载该 session
- **THEN** `/diff` fallback SHALL 可以使用加载后的 change history 生成 diff
- **THEN** `/undo` SHALL 可以使用加载后的 change history 回退上一进程中的受控修改

#### Scenario: invalid checkpoint 成为 history 边界
- **WHEN** assistant loop 执行不可追踪写入型 bash 或其他会使 checkpoint invalid 的操作
- **THEN** change history SHALL 丢弃该 invalid checkpoint 之前的 entries
- **THEN** change history SHALL 记录 invalid boundary 及其原因
- **WHEN** 后续 `/diff` 使用 fallback source
- **THEN** fallback source SHALL NOT 跨越 invalid boundary 聚合更早 entries
- **THEN** diff surface SHALL 提示仅展示不可追踪写入边界之后的受控文件编辑记录

#### Scenario: undo 成功后同步 history
- **WHEN** 用户确认 `/undo` 且文件和 transcript 回退成功
- **THEN** 系统 SHALL 从同一份 change history 中移除或标记对应 checkpoint
- **THEN** 后续 `/diff` fallback SHALL NOT 继续展示已被成功 undo 的修改
- **THEN** 当前 session 中持久化的 change history SHALL 同步更新

### Requirement: diff surface 自适应展示文件列表和详情
系统 SHALL 使用 footer command surface 渲染 `/diff`。diff surface SHALL 展示文件列表、当前文件详情、source、总文件数、总新增行数、总删除行数和操作提示。surface SHALL 遵循现有 footer 高度预算、安全宽度和局部重绘约束，SHALL NOT 使用 alternate screen。

#### Scenario: diff surface 展示摘要和文件列表
- **WHEN** diff surface 可见且存在可展示文件
- **THEN** surface SHALL 显示 `/diff` 标题或等价标题
- **THEN** surface SHALL 显示当前 source 为 Git 或 fallback history
- **THEN** surface SHALL 显示文件数量、总新增行数和总删除行数
- **THEN** surface SHALL 显示包含当前选中文件的文件列表

#### Scenario: 宽屏详情使用 side-by-side
- **WHEN** diff surface 可见
- **AND** 当前详情区域宽度足以容纳 old/new 两侧内容和行号 gutter
- **THEN** 当前文件 diff 详情 SHALL 使用 side-by-side 双栏布局
- **THEN** 删除内容 SHALL 位于 old side
- **THEN** 新增内容 SHALL 位于 new side

#### Scenario: 窄屏详情使用 unified
- **WHEN** diff surface 可见
- **AND** 当前详情区域宽度不足以容纳 side-by-side 布局
- **THEN** 当前文件 diff 详情 SHALL 自动退化为 unified 单栏布局
- **THEN** 删除行 SHALL 使用 `-` 或等价标识
- **THEN** 新增行 SHALL 使用 `+` 或等价标识

#### Scenario: fallback source 显示完整性提示
- **WHEN** diff surface 使用 change history fallback
- **THEN** surface SHALL 显示“非 Git 工作区：当前 diff 基于受控文件编辑历史拼接，可能不包含手动编辑或 shell 写入”或等价的工具无关提示

#### Scenario: 不使用 alternate screen
- **WHEN** diff surface 打开、重绘或关闭
- **THEN** 系统 SHALL NOT 输出进入或离开 alternate screen 的 ANSI 序列
- **THEN** 系统 SHALL 保持当前 terminal scrollback 语义

