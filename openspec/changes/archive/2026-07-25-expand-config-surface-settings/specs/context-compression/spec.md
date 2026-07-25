## MODIFIED Requirements

### Requirement: 压缩阈值判定
系统 SHALL 在发起请求前比较当前预估 token 数与上下文窗口阈值。阈值 SHALL 为上下文窗口上限乘以当前 assistant run 初始化时取得的用户级安全比例；有效比例 SHALL 为 0.5 至 0.95，缺失或无效配置 SHALL 回退 0.8。系统 SHALL 在单次 assistant run 及其 tool continuation 内保持该比例快照。当预估值超过阈值时，系统 SHALL 触发自动上下文压缩；未超过时 SHALL 直接按现有流程发送请求。强制压缩 SHALL 继续绕过阈值判定。

#### Scenario: 使用用户配置阈值
- **WHEN** assistant run 初始化时 `compaction.thresholdRatio` 为有效比例
- **THEN** 系统 SHALL 使用该比例乘以上下文窗口上限得到本次 run 的自动压缩阈值

#### Scenario: 缺失或无效阈值回退默认值
- **WHEN** `compaction.thresholdRatio` 缺失、类型错误、不是有限数值或不在 0.5 至 0.95 范围内
- **THEN** 系统 SHALL 使用 0.8 作为自动压缩安全比例
- **THEN** 系统 SHALL NOT 因可选阈值无效阻断 assistant run

#### Scenario: 单次 run 保持阈值快照
- **WHEN** assistant run 已初始化且外部进程随后修改压缩阈值配置
- **THEN** 当前 run 的后续 tool continuation 和 provider 请求 SHALL 继续使用初始化时的比例
- **THEN** 下一次新 assistant run SHALL 读取修改后的有效比例

#### Scenario: 预估超过阈值触发压缩
- **WHEN** 发请求前的预估 token 数超过本次 run 的上下文窗口阈值
- **THEN** 系统 SHALL 在发送本次 provider 请求前触发上下文压缩

#### Scenario: 预估未超过阈值不压缩
- **WHEN** 发请求前的预估 token 数未超过本次 run 的上下文窗口阈值
- **THEN** 系统 SHALL NOT 触发压缩
- **THEN** 系统 SHALL 按现有流程发送请求

#### Scenario: 强制压缩不受用户阈值影响
- **WHEN** 用户通过 `/compact` 或等价调用以强制模式执行压缩
- **THEN** 系统 SHALL 跳过用户级安全比例的阈值判定
- **THEN** 系统 SHALL 继续执行既有边界计算和摘要生成规则

