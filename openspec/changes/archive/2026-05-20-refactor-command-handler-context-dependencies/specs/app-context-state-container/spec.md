## MODIFIED Requirements

### Requirement: AppContext 提供派生上下文与基础状态操作
`AppContext` SHALL 统一提供 app 内部复用的派生上下文、语义子 context 和基础状态操作，例如 cwd/banner/render state 生成、`/model` 信息读取与脱敏、session 持久化/恢复和 transcript 清空。`AppContext` SHALL NOT 继续要求 command runtime 通过单一聚合 command context 获取所有 handler 可能需要的业务数据。

#### Scenario: AppContext 组合语义子 context
- **WHEN** `createApp()` 创建新的 app 实例
- **THEN** `AppContext` SHALL 组合与 composer、transcript/session、model 信息、assistant turn/pending 和 render/banner 相关的语义子 context 或等价职责边界
- **THEN** 这些子 context SHALL 与当前 app 实例状态保持一致，并且 SHALL NOT 作为模块级全局单例复用

#### Scenario: AppContext 为 handler 注册提供最小语义依赖
- **WHEN** app 装配默认 slash command handlers
- **THEN** 装配逻辑 SHALL 从 `AppContext` 取得具体 handler 需要的子 context 或读取能力
- **THEN** handler SHALL 只接收自身实际需要的子 context 或纯配置，而不是完整 `AppContext` 或统一的大 command context

#### Scenario: AppContext 不再生成 slash 大上下文
- **WHEN** command runtime 启动 slash handler 或向活跃 command session 分发事件
- **THEN** command runtime SHALL NOT 要求 `AppContext` 生成包含所有命令业务字段的统一 slash 可读上下文
- **THEN** `modelCommandInfo`、可恢复 session metadata 等命令专用读取数据 SHALL 由对应 handler 通过构造期注入的子 context 获取

#### Scenario: AppContext 处理 session 持久化和恢复的基础操作
- **WHEN** app 需要保存当前 transcript session、加载既有 session 或清空当前 transcript
- **THEN** 相关基础状态操作 SHALL 由 `AppContext` 或其 transcript/session 子 context 提供统一入口
- **THEN** 行为 SHALL 保持与现有 transcript persistence 契约一致

#### Scenario: createApp 不再保留测试专用状态快照接口
- **WHEN** `AppContext` 抽离完成
- **THEN** `createApp()` SHALL NOT 为兼容旧测试而继续暴露仅供测试使用的全量运行时状态快照接口
- **THEN** 与状态迁移相关的验证 SHALL 通过公开行为观测点或 `AppContext` 单元测试完成
