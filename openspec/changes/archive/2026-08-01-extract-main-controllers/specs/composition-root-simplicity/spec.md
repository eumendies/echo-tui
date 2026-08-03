## MODIFIED Requirements

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
