## Context

`echo_tui` 当前的 app 顶层编排集中在 `src/app/main.js`：它既负责依赖装配，也直接持有 composer、transcript、session、response lock、spinner、pending、input history 等共享状态，还包含一组围绕这些状态的 helper，例如 render state 生成、banner context 生成、`/model` 配置读取与脱敏、session 持久化/恢复、transcript 清空等。

这种闭包式组织在功能较少时是直接且高效的，但随着真实 LLM adapter、`/clear`、`/resume`、只读 `/model`、持久化失败恢复等能力进入同一个文件，`main.js` 已经同时承担“状态容器 + 业务 helper + 事件编排器”三类职责。继续沿着当前方式添加命令和上下文，会让文件体积和局部状态依赖继续增长。

本次重构的核心不是改变用户可见行为，而是把“实例级共享状态及其派生/基础操作”从 `main.js` 收拢到一个明确的对象边界里，同时保住 slash runtime 契约和真实 LLM 接入语义，并去掉仅服务旧测试的 `getState()` 观察口。

## Goals / Non-Goals

**Goals:**
- 引入实例级 `AppContext` 类，作为 `createApp()` 内部唯一的共享状态容器。
- 把依赖同一批共享状态的 helper 收拢到 `AppContext` 方法中，减少 `main.js` 顶层局部变量和内联辅助函数数量。
- 保持 `createApp(options).runAgent`、`createApp(options).resolveSlashCommand`、slash runtime 行为、持久化契约和真实 LLM adapter contract 不变。
- 删除 `createApp().getState()` 这类仅供测试消费的状态快照接口，并让测试迁移到公开行为和更合适的单元边界。
- 保持 `command-runtime` 的职责边界：它只管理命令会话、effect interpreter 和事件分发，不接管 app 级状态机。
- 让后续命令或上下文扩展优先通过 `AppContext` 增加实例方法，而不是继续堆叠 `main.js` 闭包变量。

**Non-Goals:**
- 不把整个 app 改成模块级全局单例；`AppContext` 必须是每个 `createApp()` 调用独立创建的实例。
- 不引入多层 class hierarchy、IoC 容器或新的运行时依赖。
- 不在本次重构中重写 `command-runtime` 为 class，也不改变现有 slash handler 协议。
- 不改变 renderer、agent adapter、transcript store 的对外接口。

## Decisions

### 1. 使用实例级 `AppContext` 类，而不是模块级单例或继续堆闭包 helper

新增 `src/app/app-context.js`，导出 `AppContext` 类。`createApp(options)` 在启动时创建一个 `AppContext` 实例，并把原先散落在 `main.js` 的共享状态移动到实例字段中。

选择 class 的原因：
- 当前状态天然属于“一个 app 实例”，适合用对象字段表达。
- 许多 helper 都依赖同一批共享状态，改成实例方法后语义更集中。
- 每个测试 harness 仍可创建独立实例，不会被模块缓存污染。

不选择模块级全局单例的原因：
- 会让测试相互污染。
- 会把“当前只有一个 app 实例”的假设硬编码进模块加载层。

不继续沿用纯闭包堆 helper 的原因：
- 无法解决 `main.js` 持续膨胀和状态分散的问题。

### 2. `AppContext` 只托管状态和基础操作，不吞并 `command-runtime`

`command-runtime` 仍然保持当前模块边界：
- 保存 active command session
- 解释 command effects
- 分发会话内事件

`AppContext` 负责提供 runtime 需要的窄操作，例如：
- reset composer
- clear transcript records
- load transcript session
- append transcript record
- 构造 slash 可读上下文（如 `modelCommandInfo`、`resumeSessions`）

这样可以避免把 `AppContext` 演化成“所有 app 逻辑都知道”的 God object，同时保持 runtime 不直接知道 transcript store、LLM config、banner context 等 app 私有细节。

备选方案是把 runtime 也并入 `AppContext`。不采用，因为这会把命令系统与 app 顶层状态机过度耦合，削弱当前 effect interpreter 的清晰边界。

### 3. 迁移对象以“高耦合状态 helper”为主，而不是一次性把所有函数都塞进 `AppContext`

优先迁移的成员包括：
- composer / transcript / session / pending / spinner / input history / previousColumns 等实例字段
- `getCurrentCwd()`、`persistCurrentTranscriptSession()`、`loadTranscriptSession()`
- `createModelCommandInfo()`、`createRenderState()`、`createBannerContext()`
- `leaveHistoryBrowsing()`、`clearTranscriptRecords()`、`createAgentErrorRecord()`

`main.js` 保留的内容主要是：
- 依赖装配
- input event switch / async submit orchestration
- runtime 与 renderer 之间的顶层协调

这样能在不大幅改动调用栈的前提下，把“状态相关逻辑”先收干净。

### 4. 删除 `createApp().getState()`，测试改为兼容代码而不是反过来

`getState()` 当前本质上是测试专用观察口，而不是用户或 CLI 运行时真正需要的外部接口。本次重构直接删除该接口，不再为了维持旧测试写法保留额外的公开 API。

替代方式：
- `createApp` 级测试优先通过注入的 renderer、transcript store、terminal、runAgent 等公开可观察副作用验证行为。
- `AppContext` 自身的状态迁移与派生逻辑通过独立单元测试覆盖。

备选方案是保留 `getState()` 并让 `AppContext` 生成快照。不采用，因为这会让运行时代码持续背负测试专用 API，削弱本次收敛职责的意义。

### 5. `/model`、持久化和 banner 上下文仍经由 app 层 seam 注入，不让 handler 或 runtime 直接读底层依赖

当前 `getModelCommandInfo`、`cwd`、`nodeVersion`、`transcriptStore` 等仍由 `createApp(options)` 注入。重构后这些依赖会被 `AppContext` 持有，再以实例方法形式提供。

这保证：
- `/model` handler 继续只消费 context，不直接读文件
- runtime 继续不接触 LLM config 和 store 内部细节
- 测试仍可通过注入 seam 隔离真实用户配置和持久化目录

## Risks / Trade-offs

- [Risk] `AppContext` 变成新的 God object → Mitigation：限制它只承载实例状态、派生上下文和基础状态操作，不并入 runtime / renderer / agent adapter 逻辑。
- [Risk] 删除 `getState()` 后需要重写部分白盒测试 → Mitigation：把状态断言迁移到 renderer/store/agent 回调等公开行为观测点，并为 `AppContext` 补充针对性单测。
- [Risk] 方法迁移后循环依赖增加，例如 `AppContext` 反向依赖 runtime → Mitigation：让 `AppContext` 只接收必要参数或在少数方法中接受 runtime snapshot，而不是持有 runtime 实例。
- [Risk] class 写法让局部修改变重 → Mitigation：仅引入单一实例类，不扩展为复杂继承体系；保持 CommonJS 和直接命名。

## Migration Plan

1. 新增 `src/app/app-context.js`，把实例状态字段和高耦合 helper 迁入类中。
2. 修改 `src/app/main.js`，改为创建 `AppContext` 实例，并通过它完成 render state、持久化和上下文读取，同时删除 `getState()`。
3. 保持 `command-runtime` 对外 API 不变，只调整注入回调的来源。
4. 更新 `test/app/main.test.js`，移除对 `getState()` 的依赖；必要时新增 `test/app/app-context.test.js`，把原先依赖状态快照的断言迁移到 `AppContext` 单测。
5. 更新架构文档，说明 `main.js`、`AppContext`、`command-runtime` 三者的新边界。

## Open Questions

- `AppContext` 是否需要直接暴露 `composer` 引用给 renderer，还是继续由 `main.js` 在 render 时组合？当前倾向继续保留 `composer` 引用暴露，以减少渲染链路变更。
- `browseHistory()` 这种既依赖输入事件又依赖共享状态的逻辑，是否要一起迁入 `AppContext`？本次可根据实现复杂度决定，但前提是不要改变 Up/Down 的可观察行为。
- 后续如果继续演进命令上下文，是否再引入 command-specific provider/factory？这次先不扩展该方向，只先收敛 app 级状态容器。
