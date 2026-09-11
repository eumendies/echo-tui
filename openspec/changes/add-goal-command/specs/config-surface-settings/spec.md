## ADDED Requirements

### Requirement: goal 评估模型设置
系统 SHALL 在 `/config` 的“常规”Tab 提供 goal 评估模型设置行，用于选择自动续跑评估器使用的模型 profile。该设置 SHALL 使用新增根配置节点 `goal.evaluationModelProfileId` 引用当前已保存的 `llm.models[].id`；未配置状态 SHALL 合法且在页面上显示为明确的未配置状态。该行 SHALL 始终可见，不依赖其他设置值。

#### Scenario: 常规页面始终显示 goal 评估模型行
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示“goal 评估模型”或等价设置行
- **THEN** 该行 SHALL 显示当前选中的 model profile，或在没有有效选择时显示明确的未配置状态
- **THEN** 该设置 SHALL 与“工具审批模式”和“审批模型”显示为不同字段

#### Scenario: 候选来自已配置 profiles
- **WHEN** goal 评估模型行处于选择状态且 `llm.models` 中存在一个或多个有效 profile
- **THEN** 用户 SHALL 能在这些 profile 之间循环选择
- **THEN** 每个选项 SHALL 至少提供可区分的 profile id 或 model label
- **THEN** 系统 SHALL NOT 要求用户重新输入 provider、API key、base URL 或 API model 名

#### Scenario: 未配置状态可保存
- **WHEN** 常规设置草稿未选择 goal 评估模型（未配置状态）
- **AND** 用户激活“保存常规设置”
- **THEN** 系统 SHALL 保存其他有效设置
- **THEN** 系统 SHALL 保持 goal 评估模型未配置
- **THEN** `/goal` 设置目标时的存在性校验 SHALL 由 goal-command 语义裁决

#### Scenario: 非法引用拒绝保存
- **WHEN** 常规设置草稿的 goal 评估模型引用了一个不在已保存 `llm.models` 中的 profile id
- **AND** 用户激活“保存常规设置”
- **THEN** 配置中心 SHALL 显示可理解的校验错误
- **THEN** 系统 SHALL NOT 写入常规设置草稿

#### Scenario: 保存保留其他配置节点
- **WHEN** 用户选择有效 goal 评估模型并激活“保存常规设置”
- **THEN** 系统 SHALL 将选中的 profile id 写入 `goal.evaluationModelProfileId`
- **THEN** 保存 SHALL 保留 `llm`、`tools` 及其他根配置节点

#### Scenario: 调整设置只修改草稿
- **WHEN** 用户调整 goal 评估模型
- **THEN** 系统 SHALL 只更新当前常规 Tab 草稿和 dirty 状态
- **THEN** 系统 SHALL NOT 在显式保存前改变进行中的评估或当前 goal 状态

#### Scenario: 配置变化对后续评估生效
- **WHEN** 配置中心保存或 config watcher 检测到 goal 评估模型变化
- **THEN** 进行中的评估 SHALL 继续使用其启动时解析的配置
- **THEN** 此后发起的评估 SHALL 使用刷新后的 profile
- **THEN** 系统 SHALL NOT 因该变化完整重绘 transcript 或追加 record
