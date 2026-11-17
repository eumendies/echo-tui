## MODIFIED Requirements

### Requirement: Ctrl+O 打开 subagent 会话窗口
用户 SHALL 能通过 Ctrl+O 打开 subagent 会话窗口；窗口 SHALL 以 destructive repaint 全屏接管（清屏后整屏重绘，不切换 alternate screen），并展示按 runId 过滤的完整子 Agent loop 内容：委派任务、内部工具调用与结果、reasoning 摘要、assistant 段与实时 draft 尾部。无子 Agent 运行记录时 SHALL 保持主会话不变。窗口 SHALL 展示当前 run 的 agent 名、任务、phase 与 elapsed。若稳定记录包含工作区元数据，窗口 SHALL 同时展示工作区方式、固定基线、执行目录、工作区路径及待集成状态；完整定位 SHALL 可按窗口宽度换行查看，SHALL NOT 因主窗口 compact 或报告预算而消失。旧记录缺少字段 SHALL 按原样展示，不补造工作区事实。

#### Scenario: 打开运行中子 Agent 的会话窗口
- **WHEN** 存在运行中或已完成的子 Agent 运行且用户按下 Ctrl+O
- **THEN** 系统 SHALL 清屏并整屏重绘该 run 的完整 loop 内容
- **THEN** 窗口 SHALL 优先定位到最新的运行中 run

#### Scenario: 无运行记录时快捷键无效
- **WHEN** 当前 transcript 没有任何子 Agent 记录且用户按下 Ctrl+O
- **THEN** 主会话 SHALL 保持不变

#### Scenario: 查看 Worker 实际工作区与成果
- **WHEN** 用户打开含 worktree 元数据的 Worker 会话窗口
- **THEN** 窗口 SHALL 显示该 run 的隔离方式、baseCommit 与实际工作目录
- **THEN** 多个 run 切换 SHALL 仅展示各自数据，且阶段完成不等于成果已集成

### Requirement: 窗口内容与恢复投影一致
会话窗口 SHALL 从主 transcript 读取子 Agent 稳定记录并增量渲染新批次；父 turn 中断或完成后窗口 SHALL 继续可用并展示最终状态；resize SHALL 按窗口投影执行 destructive recovery；/resume 重放后的子 Agent 记录 SHALL 可再次通过窗口查看。源 session 的未完成工作区 SHALL 保留其历史与经核验的工作区路径；fork 继承记录 SHALL 仍表达源创建者归属，不能变成新 session 的活动运行。窗口只读展示 SHALL NOT 启动任务、转移所有权或触发成果清理；路径不可确认或已缺失时 SHALL 区分历史引用与当前可恢复状态。

#### Scenario: 运行结束后回看
- **WHEN** 子 Agent 完成或失败后用户打开会话窗口
- **THEN** 窗口 SHALL 展示该 run 的全部历史记录与终态

#### Scenario: 窗口内 resize 恢复
- **WHEN** 窗口激活期间终端尺寸变化
- **THEN** 系统 SHALL 以窗口投影执行 destructive recovery 重绘

#### Scenario: Resume 与 fork 不改变成果创建者
- **WHEN** 用户 resume 原 session 或在 fork 后查看继承的 Worker 记录
- **THEN** 窗口 SHALL 展示原工作区归属与工作区路径，未完成者 SHALL 显示状态未确认
- **THEN** 系统 SHALL NOT 因打开窗口而重启 Worker 或取得源成果的自动清理权

#### Scenario: 历史成果路径缺失
- **WHEN** 恢复信息已确认历史 worktree 或成果文件被手工移除
- **THEN** 窗口 SHALL 保留历史引用并标明缺失，SHALL NOT 把同路径的新目录当成原成果
