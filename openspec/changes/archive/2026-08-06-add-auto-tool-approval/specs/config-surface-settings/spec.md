## ADDED Requirements

### Requirement: 工具审批模式与审批模型设置
系统 SHALL 将 `tools.approval.mode` 作为独立于 interaction mode 的工具审批模式设置，并 SHALL 在 `/config` 的“常规”Tab 中提供可见、可编辑和可持久化的选择项。有效值 SHALL 为 `manual` 和 `auto`，默认值 SHALL 为 `manual`。仅当常规设置草稿的 mode 为 `auto` 时，页面 SHALL 显示审批模型选择行；审批模型 SHALL 使用 `tools.approval.modelProfileId` 引用当前已保存的 `llm.models[].id`。

#### Scenario: 常规页面始终显示审批模式
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示“工具审批模式”或等价设置行
- **THEN** 设置值 SHALL 显示当前归一化的 `manual` 或 `auto`
- **THEN** 该设置 SHALL 与“默认启动模式”的 normal/plan 设置显示为不同字段

#### Scenario: Manual 草稿隐藏审批模型
- **WHEN** 常规设置草稿中的工具审批模式为 `manual`
- **THEN** 页面 SHALL NOT 显示审批模型选择行
- **THEN** 系统 SHALL 保留已有 model profile id 草稿值，以便用户切回 auto 时继续选择

#### Scenario: Auto 草稿显示审批模型
- **WHEN** 用户把常规设置草稿中的工具审批模式切换为 `auto`
- **THEN** 页面 SHALL 在审批模式行之后显示审批模型选择行
- **THEN** 该行 SHALL 展示当前选中的 model profile，或在没有有效选择时显示明确的未配置状态

#### Scenario: 审批模型候选来自已配置 profiles
- **WHEN** auto 草稿显示审批模型选择行且 `llm.models` 中存在一个或多个有效 profile
- **THEN** 用户 SHALL 能在这些 profile 之间循环选择
- **THEN** 每个选项 SHALL 至少提供可区分的 profile id 或 model label
- **THEN** 系统 SHALL NOT 要求用户重新输入 provider、API key、base URL 或 API model 名

#### Scenario: 切换模式动态调整焦点
- **WHEN** 用户在常规页面把审批模式从 auto 切换为 manual，导致审批模型行消失
- **THEN** handler 与 renderer SHALL 使用相同的动态 row id 集合
- **THEN** 当前 selected index SHALL 被归一化到仍存在的合法设置行
- **THEN** footer SHALL NOT 因行索引错位选中或执行其他设置

#### Scenario: 调整设置只修改草稿
- **WHEN** 用户调整工具审批模式或审批模型
- **THEN** 系统 SHALL 只更新当前常规 Tab 草稿和 dirty 状态
- **THEN** 系统 SHALL NOT 在显式保存前改变当前 assistant turn、配置文件或运行时审批策略

#### Scenario: 保存 Manual 模式
- **WHEN** 用户选择 `manual` 并激活“保存常规设置”
- **THEN** 系统 SHALL 将 `manual` 写入 `tools.approval.mode`
- **THEN** 保存 SHALL 保留已有 `tools.approval.modelProfileId`、其他 tools 字段和其他根配置节点

#### Scenario: 保存有效 Auto 模式
- **WHEN** 用户选择 `auto`、选择一个当前已保存的有效 model profile，并激活“保存常规设置”
- **THEN** 系统 SHALL 将 `auto` 写入 `tools.approval.mode`
- **THEN** 系统 SHALL 将选中的 profile id 写入 `tools.approval.modelProfileId`
- **THEN** 保存 SHALL 保留 `llm`、其他 tools 字段和其他根配置节点

#### Scenario: Auto 模式缺少有效模型时拒绝保存
- **WHEN** 常规设置草稿为 `auto`，但 model profile id 缺失或不再存在于已保存的 `llm.models`
- **AND** 用户激活“保存常规设置”
- **THEN** 配置中心 SHALL 显示可理解的校验错误
- **THEN** 系统 SHALL NOT 写入常规设置草稿

#### Scenario: 缺失或非法运行时配置回退 Manual
- **WHEN** `tools.approval.mode` 缺失或不是 `manual`、`auto`
- **THEN** TUI SHALL 使用 `manual` 工具审批模式
- **THEN** 其他有效 App settings SHALL 继续生效

#### Scenario: 配置变化下一回合生效
- **WHEN** 配置中心保存或 config watcher 检测到工具审批模式或审批模型变化
- **THEN** 当前 active assistant turn SHALL 继续使用启动时的审批设置快照
- **THEN** 下一次 assistant turn SHALL 使用刷新后的审批模式和模型 profile
- **THEN** 系统 SHALL NOT 因该变化完整重绘 transcript 或追加 record
