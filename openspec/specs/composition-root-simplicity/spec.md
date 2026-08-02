# composition-root-simplicity Specification

## Purpose
定义生产装配入口的简洁性要求，确保 app、agent runtime 等组合根只暴露真实运行所需边界，避免测试专用依赖集合反向塑造生产 API。
## Requirements
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

### Requirement: App 瘦身不得转移为泛化依赖对象
系统 SHALL 在瘦身 app 主流程时保持生产装配入口的真实运行边界清晰。拆分出的 app 内部模块 MAY 接收 AppContext、RunAgent、真实 tool/user state context、具名提交/输入协作端口、渲染回调或 transcript append 回调等运行期协作对象，但 MUST NOT 重新引入仅为测试替换实现而存在的泛化、可选 `options`、`dependencies` 或等价依赖集合。

#### Scenario: assistant turn runner 使用真实运行边界
- **WHEN** app 调用拆分后的 assistant turn lifecycle 模块
- **THEN** 调用参数 SHALL 表达一次真实 assistant turn 所需的 app 状态、agent runner、tool/user state context 和渲染/append 协作
- **THEN** 模块 SHALL NOT 暴露用于替换 spinner、timer、transcript store、renderer 或 agent 内部实现的测试专用依赖集合

#### Scenario: submission controller 使用具名运行协作边界
- **WHEN** app 装配 composer submission controller
- **THEN** controller SHALL 只接收提交路由真实需要的 app 状态、command/reference、assistant submission、shell submission、错误展示和 redraw 协作边界
- **THEN** assistant submission 边界 SHALL 传递一次用户 turn 的领域数据，而不是暴露 agent、renderer、hooks 和测试替身的泛化集合

#### Scenario: input controller 使用具名运行协作边界
- **WHEN** app 装配 input event controller
- **THEN** controller SHALL 只接收事件优先级真实需要的 state contexts、command runtime、submission action、local surface 和 lifecycle actions
- **THEN** controller SHALL NOT 接收 terminal、renderer、store 或 process 的可选测试替换实现

#### Scenario: main 拆分不制造过细 wrapper
- **WHEN** 开发者阅读拆分后的 app 主流程
- **THEN** 系统 SHALL 避免用只转发一两个调用的 wrapper 文件隐藏主流程
- **THEN** 新 controller SHALL 持有真实状态或顺序不变量，而不是仅为了降低单文件行数存在

#### Scenario: createApp 公开创建参数保持稳定
- **WHEN** 两个 controller 被加入生产装配
- **THEN** `createApp()` SHALL NOT 为 controller 测试新增 terminal、renderer、store、parser、shell runner 或 process lifecycle 的可选替换参数
- **THEN** controller 测试 SHALL 使用其公开运行边界或现有真实 context 组合
