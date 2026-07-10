## ADDED Requirements

### Requirement: 装配入口不得暴露测试专用依赖
系统 SHALL 保持 app 和 agent runtime 等生产装配入口的创建函数只表达真实运行所需边界参数。系统 MUST NOT 在这些入口上暴露仅用于测试替换实现的泛化 `options`、`dependencies` 或等价可选依赖集合。

#### Scenario: App 装配入口使用真实运行依赖
- **WHEN** 开发者阅读或调用 app 装配入口
- **THEN** 入口 SHALL 直接组合真实 terminal、renderer、transcript store、input parser、shell runner 和 process lifecycle 依赖
- **THEN** 入口 SHALL NOT 接收仅为测试替换这些依赖而存在的可选参数

#### Scenario: Agent runtime 装配入口使用真实 provider 和 tool 装配
- **WHEN** 开发者阅读或调用 agent runtime 装配入口
- **THEN** 入口 SHALL 直接使用真实 config loader、instruction loader、provider factory、tool registry 和 tool executor
- **THEN** 入口 SHALL NOT 接收仅为测试替换这些依赖而存在的可选参数

#### Scenario: 真实运行边界仍可显式传递
- **WHEN** 装配入口需要当前工作目录、MCP manager 或等价真实运行边界
- **THEN** 入口 MAY 以明确参数接收这些边界
- **THEN** 入口 SHALL NOT 为少量真实边界重新引入泛化的测试依赖对象

### Requirement: 测试不得反向塑造生产装配 API
系统 SHALL 让测试适配生产代码结构，而不是为了测试便利在生产装配入口增加替换实现参数。无法通过公共运行 seam、纯函数或低层模块稳定验证的高层 glue 行为 MAY 删除对应测试。

#### Scenario: 高层 glue 测试依赖测试专用注入
- **WHEN** 现有测试只能通过生产装配入口的测试专用注入点验证内部调用顺序或 fake 依赖交互
- **THEN** 实现 SHALL 优先删除或迁移该测试
- **THEN** 实现 SHALL NOT 为保留该测试而恢复测试专用注入点

#### Scenario: 行为可由低层公共模块覆盖
- **WHEN** 行为可以通过 AppContext、CommandRuntime、renderer、input parser、provider adapter、tool executor、纯函数或真实组合 seam 验证
- **THEN** 测试 SHALL 优先覆盖这些模块
- **THEN** 生产装配入口 SHALL 保持简洁

### Requirement: 领域参数对象不受测试专用清理影响
系统 SHALL 区分测试专用依赖集合和具有真实领域语义的参数对象。渲染布局参数、工具执行边界、SDK request options、用户配置读写参数等真实运行参数对象 MUST NOT 仅因名称包含 `options` 而被删除。

#### Scenario: 参数对象表达真实运行语义
- **WHEN** 一个参数对象来自终端尺寸、用户配置、工具执行边界、provider SDK 调用或渲染布局语义
- **THEN** 该参数对象 SHALL 被视为领域 API
- **THEN** 本能力 SHALL NOT 要求删除该参数对象

#### Scenario: 参数对象只替换生产实现供测试使用
- **WHEN** 一个参数对象的字段只用于替换生产依赖实现以方便测试
- **THEN** 该参数对象 SHALL 被视为测试专用依赖集合
- **THEN** 装配入口 SHALL 移除该参数对象或收窄为真实运行边界参数
