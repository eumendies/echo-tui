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
- **THEN** `AppContext`、`ComposerContext`、`ModelContext`、`RenderContext`、`TranscriptContext`、`TurnContext`、slash suggestion context、tool approval context 和 user question context 的运行源码实现路径 SHALL 位于 `src/app/` 下的 app 内部状态职责目录中
- **THEN** 这些模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`
