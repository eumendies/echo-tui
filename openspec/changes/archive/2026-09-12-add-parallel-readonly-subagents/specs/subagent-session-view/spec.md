## ADDED Requirements

### Requirement: Ctrl+O 打开 subagent 会话窗口
用户 SHALL 能通过 Ctrl+O 打开 subagent 会话窗口；窗口 SHALL 以 destructive repaint 全屏接管（清屏后整屏重绘，不切换 alternate screen），并展示按 runId 过滤的完整子 Agent loop 内容：委派任务、内部工具调用与结果、reasoning 摘要、assistant 段与实时 draft 尾部。无子 Agent 运行记录时 SHALL 保持主会话不变。窗口 SHALL 展示当前 run 的 agent 名、任务、phase 与 elapsed。

#### Scenario: 打开运行中子 Agent 的会话窗口
- **WHEN** 存在运行中或已完成的子 Agent 运行且用户按下 Ctrl+O
- **THEN** 系统 SHALL 清屏并整屏重绘该 run 的完整 loop 内容
- **THEN** 窗口 SHALL 优先定位到最新的运行中 run

#### Scenario: 无运行记录时快捷键无效
- **WHEN** 当前 transcript 没有任何子 Agent 记录且用户按下 Ctrl+O
- **THEN** 主会话 SHALL 保持不变

### Requirement: 窗口内运行切换
会话窗口内用户 SHALL 能通过 ↑/↓ 在 transcript 内全部子 Agent 运行之间循环切换，窗口标题 SHALL 展示当前位置与总数。切换 SHALL 立即重绘目标 run 的内容，且不影响任何正在运行的子 Agent。

#### Scenario: 在并行运行间切换
- **WHEN** transcript 内存在多个子 Agent 运行且用户在窗口内按 ↑ 或 ↓
- **THEN** 窗口 SHALL 切换并重绘相邻 run 的内容，标题展示序号与总数

#### Scenario: 活跃运行期间回看已完成 run
- **WHEN** 部分并行子运行已完成而其余仍在运行，用户在窗口内按 ↑/↓
- **THEN** 窗口 SHALL 在全部运行（含已完成）之间循环切换并立即重绘目标 run

### Requirement: Esc 返回主会话且不中断父 turn
会话窗口激活时按 Esc SHALL 关闭窗口并恢复主会话投影，SHALL NOT 中断正在运行的父 assistant turn 或任何子 Agent。窗口激活期间，用户提问、工具授权与文件选择 modal SHALL 保持更高输入优先级并浮于窗口之上；Ctrl+C/D 维持全局退出语义；窗口与 `/btw` SHALL 互斥。

#### Scenario: Esc 仅关闭窗口
- **WHEN** 子 Agent 运行期间用户在会话窗口内按 Esc
- **THEN** 窗口 SHALL 关闭并恢复主会话投影
- **THEN** 父 turn 与子 Agent SHALL 继续运行

#### Scenario: 授权 modal 浮于窗口之上
- **WHEN** 窗口激活期间某个子 Agent 发起人工授权请求
- **THEN** 授权 surface SHALL 按现有优先级展示并优先消费输入
- **THEN** 授权决议后窗口 SHALL 继续可用

### Requirement: 窗口内容与恢复投影一致
会话窗口 SHALL 从主 transcript 读取子 Agent 稳定记录并增量渲染新批次；父 turn 中断或完成后窗口 SHALL 继续可用并展示最终状态；resize SHALL 按窗口投影执行 destructive recovery；/resume 重放后的子 Agent 记录 SHALL 可再次通过窗口查看。

#### Scenario: 运行结束后回看
- **WHEN** 子 Agent 完成或失败后用户打开会话窗口
- **THEN** 窗口 SHALL 展示该 run 的全部历史记录与终态

#### Scenario: 窗口内 resize 恢复
- **WHEN** 窗口激活期间终端尺寸变化
- **THEN** 系统 SHALL 以窗口投影执行 destructive recovery 重绘
