## ADDED Requirements

### Requirement: 实例级 AppContext 状态容器
系统 SHALL 提供一个实例级 `AppContext` 状态容器，用于承载单个 `createApp()` 实例的共享运行时状态、上下文派生和基础状态操作。该容器 SHALL 为每次 `createApp()` 调用单独创建，而不是作为模块级全局单例复用。

#### Scenario: 每个 createApp 调用创建独立 AppContext 实例
- **WHEN** 测试或 CLI 分别调用 `createApp(options)` 创建多个 app 实例
- **THEN** 每个 app SHALL 拥有独立的 `AppContext` 实例
- **THEN** 一个实例中的 composer、transcript、session、pending、spinner 和输入历史状态 SHALL NOT 污染另一个实例

#### Scenario: AppContext 持有 app 共享运行时状态
- **WHEN** app 进入交互流程
- **THEN** `AppContext` SHALL 持有至少与 composer、transcript records、session 指针、response lock、pending preview、spinner 状态和输入历史相关的共享字段
- **THEN** `main.js` SHALL NOT 再通过大量顶层局部变量分别持有这些长期共享状态

### Requirement: AppContext 提供派生上下文与基础状态操作
`AppContext` SHALL 统一提供 app 内部复用的派生上下文和基础状态操作，例如 cwd/banner/render state 生成、`/model` 信息读取与脱敏、session 持久化/恢复和 transcript 清空。

#### Scenario: AppContext 生成 slash 可读上下文
- **WHEN** command runtime 需要构造传给 handler 的只读上下文
- **THEN** `AppContext` SHALL 提供当前 composer 文本、response lock 状态、输入历史、`modelCommandInfo` 和可恢复 session metadata 等所需数据
- **THEN** 这些上下文 SHALL 继续与当前 app 实例状态保持一致

#### Scenario: AppContext 处理 session 持久化和恢复的基础操作
- **WHEN** app 需要保存当前 transcript session、加载既有 session 或清空当前 transcript
- **THEN** 相关基础状态操作 SHALL 由 `AppContext` 提供统一入口
- **THEN** 行为 SHALL 保持与现有 transcript persistence 契约一致

#### Scenario: createApp 不再保留测试专用状态快照接口
- **WHEN** `AppContext` 抽离完成
- **THEN** `createApp()` SHALL NOT 为兼容旧测试而继续暴露仅供测试使用的全量运行时状态快照接口
- **THEN** 与状态迁移相关的验证 SHALL 通过公开行为观测点或 `AppContext` 单元测试完成
