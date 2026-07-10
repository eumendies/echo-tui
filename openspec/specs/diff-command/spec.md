# diff-command Specification

## Purpose
定义 `/diff` 命令的外部行为，包括 Git 优先的数据源策略、change history fallback、只读差异查看 surface，以及与 `/undo` 共享的变更历史语义。

## Requirements

### Requirement: /diff 命令打开只读差异查看
系统 SHALL 提供 `/diff` slash command，用于查看当前工作区文件差异。该命令 SHALL 使用 command runtime 和 command surface 打开只读 diff 查看面板；SHALL NOT 触发 assistant turn，SHALL NOT 追加 user、assistant、tool、local notice 或 error transcript record。

#### Scenario: 默认 slash suggestions 包含 diff
- **WHEN** 系统创建默认 slash command descriptors
- **THEN** descriptors SHALL 包含 `/diff` 及其中文说明

#### Scenario: 提交 diff 命令打开 surface
- **WHEN** 用户提交纯 `/diff`
- **THEN** 系统 SHALL 重置 composer
- **THEN** 系统 SHALL 打开 diff command surface
- **THEN** 系统 SHALL NOT 启动普通 assistant turn
- **THEN** 系统 SHALL NOT 追加 transcript record

#### Scenario: 无差异时展示信息
- **WHEN** 用户提交 `/diff`
- **AND** 当前 diff source 没有可展示文件差异
- **THEN** 系统 SHALL 展示可关闭的信息 surface 或空 diff surface
- **THEN** 展示内容 SHALL 说明当前没有可展示差异

### Requirement: diff source 优先使用 Git 工作区
系统 SHALL 在 `/diff` 中优先使用 Git source。当 git 可用且当前 cwd 位于 Git worktree 内时，系统 SHALL 读取 Git 工作区差异并作为 `/diff` 的主数据源。Git source SHALL 使用只读 Git 命令，SHALL 禁用 external diff 和颜色输出，并 SHALL NOT 通过 bash tool、tool approval 或 transcript 工具流执行。

#### Scenario: Git 工作区使用 Git source
- **WHEN** 用户在 Git worktree 内提交 `/diff`
- **AND** Git diff 读取成功
- **THEN** diff surface SHALL 使用 Git source
- **THEN** diff surface SHALL 展示 Git 工作区的文件差异
- **THEN** diff surface SHALL NOT 显示非 Git fallback 完整性提示

#### Scenario: Git 不可用时降级
- **WHEN** 用户提交 `/diff`
- **AND** 系统无法执行 git 命令
- **THEN** 系统 SHALL 尝试使用 change history fallback
- **THEN** fallback surface SHALL 显示 Git source 不可用或非 Git fallback 的提示

#### Scenario: 非 Git 工作区降级
- **WHEN** 用户在非 Git worktree 目录提交 `/diff`
- **THEN** 系统 SHALL 使用 change history fallback
- **THEN** diff surface SHALL 明确提示当前不是 Git 工作区，diff 基于 `apply_patch` 历史拼接

#### Scenario: Git source 失败时降级
- **WHEN** 用户提交 `/diff`
- **AND** 当前目录位于 Git worktree 内
- **AND** Git diff 读取失败
- **THEN** 系统 SHALL 尝试使用 change history fallback
- **THEN** diff surface SHALL 显示降级原因或等价错误摘要

### Requirement: change history fallback 持久化受控编辑历史
系统 SHALL 为非 Git fallback 和 `/undo` 维护同一份可序列化 change history。change history SHALL 记录受控 `apply_patch` 成功写入文件所需的 before snapshot、写入状态、checkpoint 时间、transcript 边界、compaction 状态和 invalid boundary；该 history SHALL 随当前 transcript session 持久化，并在 `/resume` 加载 session 后恢复给 `/diff` 与 `/undo` 共用。

#### Scenario: apply_patch 成功写入进入 history
- **WHEN** assistant loop 中 `apply_patch` 成功写入一个已有文本文件
- **THEN** change history SHALL 记录该文件写入前的 snapshot 和 `updated` 状态
- **WHEN** assistant loop 中 `apply_patch` 成功新增一个文本文件
- **THEN** change history SHALL 记录该文件写入前不存在和 `created` 状态

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
- **THEN** diff surface SHALL 提示仅展示不可追踪写入边界之后的 `apply_patch` 记录

#### Scenario: undo 成功后同步 history
- **WHEN** 用户确认 `/undo` 且文件和 transcript 回退成功
- **THEN** 系统 SHALL 从同一份 change history 中移除或标记对应 checkpoint
- **THEN** 后续 `/diff` fallback SHALL NOT 继续展示已被成功 undo 的修改
- **THEN** 当前 session 中持久化的 change history SHALL 同步更新

### Requirement: history fallback 从 before snapshot 生成当前 diff
系统 SHALL 在 fallback source 中按文件聚合最近 invalid boundary 之后的 ready history entries。同一文件 SHALL 使用最早 before snapshot 作为 old side，并读取当前磁盘文件作为 new side 生成 diff。fallback source SHALL 明确标识自身不是 Git source，且 MAY 跳过无法安全读取或比较的文件并展示 notice。

#### Scenario: 多次修改同一文件折叠为最终差异
- **GIVEN** change history 中同一文件存在多个 ready entries
- **WHEN** `/diff` 使用 fallback source
- **THEN** 系统 SHALL 使用该文件最早 before snapshot 和当前磁盘内容生成一份最终 diff
- **THEN** diff surface SHALL NOT 为同一文件重复显示多个历史 patch

#### Scenario: 新增文件生成 added diff
- **GIVEN** change history 记录某文件在 first snapshot 中不存在
- **AND** 当前磁盘上该文件存在且可读取为文本
- **WHEN** `/diff` 使用 fallback source
- **THEN** diff surface SHALL 将该文件显示为新增文件
- **THEN** 该文件统计 SHALL 计入新增行数

#### Scenario: 删除文件生成 deleted diff
- **GIVEN** change history 记录某文件在 first snapshot 中存在
- **AND** 当前磁盘上该文件不存在
- **WHEN** `/diff` 使用 fallback source
- **THEN** diff surface SHALL 将该文件显示为删除文件
- **THEN** 该文件统计 SHALL 计入删除行数

#### Scenario: 无法比较的文件显示 notice
- **GIVEN** change history 中某文件当前不可读取、不是普通文件、超过文本限制或包含二进制内容
- **WHEN** `/diff` 使用 fallback source
- **THEN** 系统 MAY 跳过该文件的 diff 内容
- **THEN** diff surface SHALL 显示该文件无法比较的提示或汇总 notice

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
- **THEN** surface SHALL 显示“非 Git 工作区：当前 diff 基于 apply_patch 历史拼接，可能不包含手动编辑或 shell 写入”或等价提示

#### Scenario: 不使用 alternate screen
- **WHEN** diff surface 打开、重绘或关闭
- **THEN** 系统 SHALL NOT 输出进入或离开 alternate screen 的 ANSI 序列
- **THEN** 系统 SHALL 保持当前 terminal scrollback 语义

### Requirement: diff surface 使用方向键交互
系统 SHALL 只依赖现有方向键、Enter 和 Esc 操作 diff surface。Up/Down 的语义 SHALL 由当前焦点决定；Left/Right SHALL 切换文件列表和详情焦点；Enter 和 Esc SHALL 关闭 surface 并回到普通 composer。

#### Scenario: list focus 下 Up/Down 移动文件
- **WHEN** diff surface 处于 list focus
- **AND** 用户按 Up 或 Down
- **THEN** 系统 SHALL 移动当前选中文件
- **THEN** 系统 SHALL 重置当前文件详情滚动位置

#### Scenario: detail focus 下 Up/Down 滚动详情
- **WHEN** diff surface 处于 detail focus
- **AND** 用户按 Up 或 Down
- **THEN** 系统 SHALL 滚动当前文件 diff 详情
- **THEN** 系统 SHALL NOT 改变当前选中文件

#### Scenario: Left/Right 切换焦点
- **WHEN** diff surface 可见
- **AND** 用户按 Right
- **THEN** 系统 SHALL 将焦点切换到 diff 详情
- **WHEN** 用户按 Left
- **THEN** 系统 SHALL 将焦点切换到文件列表

#### Scenario: Enter/Esc 关闭 diff
- **WHEN** diff surface 可见
- **AND** 用户按 Enter 或 Esc
- **THEN** 系统 SHALL 关闭 diff surface
- **THEN** 系统 SHALL 回到普通 composer
- **THEN** 系统 SHALL NOT 修改文件或 transcript

#### Scenario: 不要求额外快捷键
- **WHEN** diff surface 可见
- **THEN** 系统 SHALL NOT 要求用户使用 hjkl、PageUp、PageDown、跳 hunk、搜索或手动 layout toggle 完成基本查看
