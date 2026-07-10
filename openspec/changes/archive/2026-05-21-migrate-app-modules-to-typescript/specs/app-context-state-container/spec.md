## MODIFIED Requirements

### Requirement: 实例级 AppContext 状态容器
系统 SHALL 提供一个实例级 `AppContext` 组合根，用于组合单个 `createApp()` 实例的语义子 context、上下文派生和基础状态操作。该组合根 SHALL 为每次 `createApp()` 调用单独创建，而不是作为模块级全局单例复用。

#### Scenario: 每个 createApp 调用创建独立 AppContext 实例
- **WHEN** 测试或 CLI 分别调用 `createApp(options)` 创建多个 app 实例
- **THEN** 每个 app SHALL 拥有独立的 `AppContext` 实例
- **THEN** 一个实例中的 composer、transcript、session、pending、spinner 和输入历史状态 SHALL NOT 污染另一个实例

#### Scenario: AppContext 组合语义子 context
- **WHEN** app 进入交互流程
- **THEN** `AppContext` SHALL 组合与 composer、transcript/session、model 信息、assistant turn/pending 和 render/banner 相关的语义子 context 或等价职责边界
- **THEN** composer、transcript records、session 指针、response lock、pending preview、spinner 状态、输入历史和 render columns 等长期状态 SHALL 由对应语义子 context 持有，而不是由 `AppContext` 重复保存
- **THEN** `main.ts` SHALL 只面对单个 `AppContext` 组合根，不应拆箱并长期持有各个子 context 局部变量

#### Scenario: AppContext 模块路径
- **WHEN** `AppContext` 与相关 app 子 context 参与运行源码构建
- **THEN** `AppContext`、`ComposerContext`、`ModelContext`、`RenderContext`、`TranscriptContext` 和 `TurnContext` 的运行源码实现路径 SHALL 分别位于 `src/app/*.ts`
- **THEN** 这些模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

### Requirement: AppContext 提供派生上下文与基础状态操作
`AppContext` SHALL 统一提供 app 内部复用的派生上下文、语义子 context 和基础状态操作，例如 cwd/banner/render state 生成、`/model` 信息读取与脱敏、session 持久化/恢复和 transcript 清空。command runtime SHALL 通过 handler 的具体依赖获取业务数据，而不是通过单一聚合 command context 获取所有 handler 可能需要的数据。

#### Scenario: AppContext 为 handler 注册提供最小语义依赖
- **WHEN** app 装配默认 slash command handlers
- **THEN** 装配逻辑 SHALL 从 `AppContext` 取得具体 handler 需要的子 context 或读取能力
- **THEN** handler SHALL 只接收自身实际需要的子 context 或纯配置，而不是完整 `AppContext` 或统一的大 command context

#### Scenario: AppContext 不生成 slash 大上下文
- **WHEN** command runtime 启动 slash handler 或向活跃 command session 分发事件
- **THEN** command runtime SHALL NOT 要求 `AppContext` 生成包含所有命令业务字段的统一 slash 可读上下文
- **THEN** `modelCommandInfo`、可恢复 session metadata 等命令专用读取数据 SHALL 由对应 handler 通过构造期注入的子 context 获取

#### Scenario: AppContext 处理 session 持久化和恢复的基础操作
- **WHEN** app 需要保存当前 transcript session、加载既有 session 或清空当前 transcript
- **THEN** 相关基础状态操作 SHALL 由 `AppContext` 或其 transcript/session 子 context 提供统一入口
- **THEN** 行为 SHALL 与 transcript persistence 契约一致

#### Scenario: createApp 不提供测试专用状态快照接口
- **WHEN** 测试验证 app 状态行为
- **THEN** `createApp()` SHALL NOT 暴露仅供测试使用的全量运行时状态快照接口
- **THEN** 状态相关验证 SHALL 通过公开行为观测点或 `AppContext` 单元测试完成

#### Scenario: AppContext 门面语义稳定
- **WHEN** `AppContext` 与五个语义子 context 管理 app 状态
- **THEN** cwd / nodeVersion 读取、banner context 生成、render state 生成、input history 浏览、transcript 追加与恢复、pending 状态切换和 assistant turn 完成/失败处理 SHALL 保持稳定
- **THEN** 类型约束 SHALL NOT 新增全局状态、重复状态副本或改变门面方法的公开 contract
