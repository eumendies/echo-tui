## ADDED Requirements

### Requirement: App 瘦身不得转移为泛化依赖对象
系统 SHALL 在瘦身 app 主流程时保持生产装配入口的真实运行边界清晰。拆分出的 app 内部模块 MAY 接收 AppContext、RunAgent、真实 tool/user state context、渲染回调或 transcript append 回调等运行期协作对象，但 MUST NOT 重新引入仅为测试替换实现而存在的泛化 `options`、`dependencies` 或等价可选依赖集合。

#### Scenario: assistant turn runner 使用真实运行边界
- **WHEN** app 调用拆分后的 assistant turn lifecycle 模块
- **THEN** 调用参数 SHALL 表达一次真实 assistant turn 所需的 app 状态、agent runner、tool/user state context 和渲染/append 协作
- **THEN** 模块 SHALL NOT 暴露用于替换 spinner、timer、transcript store、renderer 或 agent 内部实现的测试专用依赖集合

#### Scenario: main 拆分不制造过细 wrapper
- **WHEN** 开发者阅读拆分后的 app 主流程
- **THEN** 系统 SHALL 避免用只转发一两个调用的 wrapper 文件隐藏主流程
- **THEN** 新模块 SHALL 保护真实职责边界或移除有意义的重复，而不是仅为了降低单文件行数存在
