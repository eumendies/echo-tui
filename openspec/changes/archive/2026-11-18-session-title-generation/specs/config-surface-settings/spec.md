## ADDED Requirements

### Requirement: 标题生成模型设置
系统 SHALL 在 `/config` 的“常规”Tab 中提供单行“标题生成模型”设置，该行 SHALL 表达三种互斥状态：

1. **不生成**：`sessions.titleGenerationEnabled` 为 `false`，系统不发起标题生成。
2. **跟随当前模型**：`sessions.titleGenerationEnabled` 为 `true` 且 `sessions.titleModelProfileId` 缺失，使用当前生效模型并覆盖 `low` effort。
3. **指定 profile**：`sessions.titleGenerationEnabled` 为 `true` 且 `sessions.titleModelProfileId` 引用当前已保存的 `llm.models[].id`，使用该 profile 并覆盖 `low` effort。

该行 SHALL 按“不生成 → 跟随当前模型 → 各已保存 profile”的顺序循环。切换到“不生成”时 SHALL 保留原有 `titleModelProfileId` 草稿值，以便用户切回原选择。失效引用 SHALL 在运行时导致生成失败而不回退全局模型。

#### Scenario: 常规页面展示标题生成行
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示“标题生成模型”或等价设置行
- **THEN** 该行 SHALL 显示“不生成”、“跟随当前模型”或当前选中 profile 三者之一
- **THEN** 该行 SHALL 与工具审批模型行显示为不同字段

#### Scenario: 循环切换三态
- **WHEN** 用户在标题生成模型行上连续调整取值
- **THEN** 草稿 SHALL 依次经过“不生成”、“跟随当前模型”与每个已保存 profile
- **THEN** 草稿为“不生成”时 SHALL 保留此前选中的 profile 引用
- **THEN** 系统 SHALL NOT 在显式保存前修改配置文件

#### Scenario: 选择不生成
- **WHEN** 用户把标题生成模型切到“不生成”并保存
- **THEN** 系统 SHALL 写入 `sessions.titleGenerationEnabled: false`
- **THEN** 后续新会话 SHALL NOT 发起标题生成请求

#### Scenario: 选择跟随当前模型
- **WHEN** 用户把标题生成模型切到“跟随当前模型”并保存
- **THEN** 系统 SHALL 从配置中删除 `sessions.titleModelProfileId`
- **THEN** 重新读取配置 SHALL NOT 再返回该 profile 引用
- **THEN** 系统 SHALL 使用当前生效模型并覆盖 `low` effort 生成标题

#### Scenario: 候选来自已配置 profiles
- **WHEN** 标题生成模型行处于编辑状态且 `llm.models` 中存在一个或多个有效 profile
- **THEN** 用户 SHALL 能在这些 profile 之间循环选择
- **THEN** 每个选项 SHALL 至少提供可区分的 profile id 或 model label
- **THEN** 系统 SHALL NOT 要求用户重新输入 provider、API key、base URL 或 API model 名

#### Scenario: 保存有效模型引用
- **WHEN** 用户选择一个当前已保存的有效 model profile 并激活“保存常规设置”
- **THEN** 系统 SHALL 将选中的 profile id 写入 `sessions.titleModelProfileId`
- **THEN** 系统 SHALL 写入 `sessions.titleGenerationEnabled: true`
- **THEN** 保存 SHALL 保留 `llm`、`sessions` 下其他字段和其他根配置节点

#### Scenario: 引用失效时拒绝保存
- **WHEN** 标题生成处于开启状态，且草稿引用的 profile 不再存在于已保存的 `llm.models`
- **AND** 用户激活“保存常规设置”
- **THEN** 配置中心 SHALL 显示可理解的校验错误
- **THEN** 系统 SHALL NOT 写入常规设置草稿

#### Scenario: 关闭状态下容忍失效引用
- **WHEN** 标题生成处于关闭状态，且草稿保留了已失效的 profile 引用
- **AND** 用户激活“保存常规设置”
- **THEN** 系统 SHALL 正常保存
- **THEN** 保存 SHALL 保留该失效引用，以便用户重新开启时看见原选择

#### Scenario: 调整设置只修改草稿
- **WHEN** 用户调整标题生成模型选择
- **THEN** 系统 SHALL 只更新当前常规 Tab 草稿和 dirty 状态
- **THEN** 系统 SHALL NOT 在显式保存前改变配置文件或正在进行的标题生成

#### Scenario: 非法运行时配置独立回退
- **WHEN** `sessions.titleGenerationEnabled` 非布尔、或 `sessions.titleModelProfileId` 非字符串
- **THEN** TUI SHALL 继续正常启动
- **THEN** 开关 SHALL 回退为开启，profile 引用 SHALL 回退为未配置
- **THEN** 其他有效 App settings SHALL 继续生效
