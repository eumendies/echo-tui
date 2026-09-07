## ADDED Requirements

### Requirement: 多工具 pending footer 投影
主 TUI 和 BTW SHALL 能同时保存并投影多个并行执行中的只读 pending tool call，而不是用后到调用覆盖先到调用。两个及以上 pending 调用 SHALL 使用单一 compact 活动块，包含共享的运行中工具数量标题，并按 provider 原始顺序为每个可见工具最多展示一个带工具名和关键目标摘要的列表行；系统 SHALL NOT 为多调用 pending 堆叠完整单工具卡片。单工具 pending 和完成后的历史投影 SHALL 保持既有样式。Footer SHALL 受现有高度与 safe render width 约束。

#### Scenario: 同时展示多个只读调用
- **WHEN** agent loop 同时启动多个连续只读调用
- **THEN** footer SHALL 使用一个共享标题展示运行中调用总数
- **THEN** footer SHALL 在标题下按 provider 原始调用顺序展示 compact 工具行
- **THEN** 每个可见工具 SHALL 最多占一个物理行，并保留工具名及 query、路径、URL 或其他关键目标摘要
- **THEN** footer SHALL NOT 为每个调用重复完整 marker、rail 或 searching/fetching 状态

#### Scenario: Footer 空间不足时有界显示
- **WHEN** 多个 pending tool previews 的物理行数超过 footer 可用预算
- **THEN** footer SHALL 保留共享标题和可容纳的前序工具行，并用 `… +N more` 或等价文案表示实际隐藏调用数
- **THEN** 若只有一个可用物理行，footer SHALL 仅显示运行中工具数量标题
- **THEN** composer、status line 和光标位置 SHALL 保持可用

#### Scenario: 高度变化不切换完整卡片
- **WHEN** terminal resize 改变多工具 pending 的可用高度
- **THEN** footer SHALL 仅调整 compact 列表的可见工具数量
- **THEN** footer SHALL NOT 因空间增加而切换为完整单工具卡片堆叠

#### Scenario: 单工具 pending 保持既有样式
- **WHEN** 当前只有一个 pending tool call
- **THEN** footer SHALL 继续使用该工具既有的专属或通用 pending renderer

#### Scenario: BTW 使用独立多工具 pending 状态
- **WHEN** BTW readonly side turn 启动多个可并行工具调用
- **THEN** BTW footer SHALL 展示该 side turn 的多个 pending 调用
- **THEN** 这些 pending 状态 SHALL NOT 覆盖或写入主 turn 的 pending 状态

### Requirement: 并行工具完成后的成对历史投影
一组连续只读调用全部完成后，系统 SHALL 按 provider 原始调用顺序将每个 call/result 作为相邻匹配记录提交，并 SHALL 继续使用现有 pair-aware renderer 显示成功、失败和专属工具结果。Footer pending 记录 SHALL 在对应稳定 pair 提交后移除，且 SHALL NOT 重复出现在历史区。

#### Scenario: 完成顺序不同仍按原序展示
- **WHEN** 多个并行调用以不同于 provider 顺序的顺序完成
- **THEN** transcript 历史区 SHALL 按 provider 原始顺序展示完整 tool pairs
- **THEN** 每个调用标记 SHALL 使用自身 result 的成功或失败状态

#### Scenario: Pending 转为稳定历史记录
- **WHEN** 一组同时执行的连续只读调用全部得到稳定结果
- **THEN** renderer SHALL 清除这些调用的 pending previews
- **THEN** renderer SHALL 将完整 call/result pairs 追加到历史区
- **THEN** 同一 tool call SHALL NOT 同时作为遗留 pending 和稳定 pair 重复显示

#### Scenario: Resize 重建并行 pending 投影
- **WHEN** 并行工具执行期间 terminal columns 变化或 rows 缩小并触发 destructive repaint
- **THEN** renderer SHALL 从当前 app 状态重建全部仍活跃的 pending tool previews
- **THEN** 已稳定提交的历史 pairs SHALL 按新宽度重绘

#### Scenario: 中断清空未完成 pending 调用
- **WHEN** 当前 assistant turn 在并行只读调用全部完成前被中断
- **THEN** renderer SHALL 清空该 turn 的全部 pending tool previews
- **THEN** renderer SHALL NOT 为没有稳定 result 的调用伪造成功、失败或历史 pair
