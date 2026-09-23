## MODIFIED Requirements

### Requirement: 按引用预算选择全量或总结投影
系统 SHALL 使用现有 token estimator 估算中立引用材料，并以 `max(2000, min(12000, floor(contextWindow * 0.10)))` 作为单个会话的引用预算。估算未超过预算时系统 SHALL 生成全量投影；超过预算时系统 SHALL 在用户提交下一条普通消息时，使用当前生效模型生成结构化引用总结。总结请求的输入 token 估算 SHALL NOT 超过 `min(64000, floor(contextWindow * 0.5))` 的总结输入上限；材料超过该上限时系统 SHALL 先按头尾保留策略截断材料，再发起一次无工具的专用摘要请求，SHALL NOT 为同一引用的降级截断使用多次 provider 请求。确认选择历史会话本身 SHALL NOT 发起 provider 请求。

#### Scenario: 短会话全量导入
- **WHEN** 被引用会话材料的预估 token 数不超过引用预算
- **THEN** 系统 SHALL 将最终有效会话材料全量放入引用投影
- **THEN** 系统 SHALL NOT 为该引用发起摘要请求

#### Scenario: 长会话生成引用总结
- **WHEN** 被引用会话材料的预估 token 数超过引用预算且用户提交当前请求
- **THEN** 系统 SHALL 发起一次无工具的专用摘要请求
- **THEN** 摘要 SHALL 覆盖会话背景与目标、关键决定、重要事实、文件与符号、未决事项和会话脉络
- **THEN** 系统 SHALL NOT 修改源 session 的 compaction 状态或 journal

#### Scenario: 引用总结不继承工具但携带会话 reasoning
- **WHEN** 当前 agent 注册了工具或配置了普通 reasoning 参数且系统生成引用总结
- **THEN** 摘要 provider 请求 SHALL NOT 包含工具定义或工具调用控制参数
- **THEN** 引用总结 SHALL 与压缩摘要请求相互独立：压缩摘要携带工具定义的行为 SHALL NOT 使引用总结一并携带
- **THEN** 摘要 provider 请求 SHALL 按与普通 turn 相同的规则携带当前会话配置的 reasoning effort（含显式 `none` 的禁用语义）
- **THEN** 摘要 provider 请求 SHALL NOT 携带仅供展示的 reasoning summary 配置或 reasoning 加密回传请求
- **THEN** 使用 codex adapter 时，引用总结请求 SHALL NOT 携带固定 `low` verbosity

#### Scenario: 素材超过总结输入上限时头尾截断降级
- **WHEN** 引用材料的预估 token 数超过总结输入上限且用户提交当前请求
- **THEN** 系统 SHALL 先按头尾保留策略截断材料：优先保留 compacted_summary 区块、最早若干条与最近若干条记录，中间记录 SHALL 以明确省略标注表达
- **THEN** 截断后的摘要请求输入 SHALL NOT 超过总结输入上限
- **THEN** 系统 SHALL 只发起一次无工具摘要请求，SHALL NOT 使用分块归并等多请求策略

#### Scenario: 总结输入上限随当前生效模型重新计算
- **WHEN** 用户改变本轮生效模型或 reasoning 配置后提交带引用的请求
- **THEN** 引用预算与总结输入上限 SHALL 按本轮生效模型的 contextWindow 重新计算
- **THEN** 全量、总结与截断判定 SHALL 使用本轮计算结果，SHALL NOT 沿用选择会话时的判定结果
