## MODIFIED Requirements

### Requirement: 并行工具完成后的成对历史投影
一组连续只读调用全部完成后，系统 SHALL 按 provider 原始调用顺序将每个 call/result 作为相邻匹配记录提交，并 SHALL 继续使用现有 pair-aware renderer 显示成功、失败和专属工具结果。Footer pending 记录 SHALL 在对应稳定 pair 提交后移除，且 SHALL NOT 重复出现在历史区。中断发生在并行段未完成时，renderer SHALL 清空该 turn 的全部 pending previews，并由 app 状态层为每个未完成调用补写相邻 call/result pair；renderer SHALL NOT 自行构造或伪造工具结果。

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
- **THEN** app 状态层 SHALL 为每个未取得结果的调用补写相邻 call/result pair，renderer SHALL 按既有 pair-aware renderer 将合成失败结果投影为失败工具结果
- **THEN** renderer SHALL NOT 为没有稳定 result 的调用自行伪造成功结果
