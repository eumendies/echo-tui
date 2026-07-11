# app-context-state-container Specification

## Purpose
定义 `AppContext` 作为单个 `createApp()` 实例组合根的状态边界，包括语义子 context 组合、派生上下文、基础状态操作和测试可观测性约束。

## Requirements

### Requirement: 实例级 AppContext 状态容器
系统 SHALL 提供一个实例级 `AppContext` 组合根，用于组合单个 `createApp()` 实例的语义子 context、上下文派生和基础状态操作。该组合根 SHALL 为每次 `createApp()` 调用单独创建，而不是作为模块级全局单例复用。

#### Scenario: 每个 createApp 调用创建独立 AppContext 实例
- **WHEN** 测试或 CLI 分别通过 `createApp(runAgent, ...)` 或 CLI 入口创建多个 app 实例
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

### Requirement: ModelContext 缓存模型展示状态
系统 SHALL 由实例级 `ModelContext` 维护当前模型展示所需的内存状态缓存。该缓存 SHALL 至少支持普通 status line 派生当前模型 label 和当前模型 profile 显式配置的 reasoning effort，并 SHALL 保持在单个 `createApp()` 实例内隔离。普通 footer/status line render state 派生 SHALL 从该缓存读取模型展示状态，不得在每次 redraw 中同步读取或解析用户级 LLM 配置文件。

#### Scenario: 高频 footer redraw 不读取用户配置
- **WHEN** spinner tick 或 streaming token render timer 触发普通 footer redraw
- **THEN** AppContext/RenderContext SHALL 从 `ModelContext` 的内存缓存派生 status line 模型状态
- **THEN** 本次 redraw SHALL NOT 因生成模型 label 或 reasoning effort 而读取或解析 `~/.echo/config.json`

#### Scenario: ModelContext 缓存保持实例隔离
- **WHEN** 测试或 CLI 创建多个 `createApp()` 实例
- **THEN** 每个实例 SHALL 拥有独立的 `ModelContext` 模型状态缓存
- **THEN** 一个实例中通过 `/model`、`/effort` 或 `/config` 更新的缓存 SHALL NOT 污染另一个实例

#### Scenario: 配置读取失败时 footer 保持稳定
- **WHEN** `ModelContext` 刷新模型状态缓存时无法读取或解析用户级 LLM 配置
- **THEN** `ModelContext` SHALL 保存可供 UI 使用的安全错误状态或 unavailable 状态
- **THEN** 后续普通 footer redraw SHALL 使用该状态渲染稳定占位，而不是在 render path 抛出配置读取异常

### Requirement: 应用内模型配置写入刷新 ModelContext 缓存
系统 SHALL 在应用内模型配置写入成功后刷新 `ModelContext` 模型状态缓存。刷新 SHALL 基于写入后的用户级 LLM 配置重新解析模型 profile、当前选择和 reasoning effort。写入失败时系统 SHALL NOT 把未持久化的模型选择或 reasoning effort 写入缓存。

#### Scenario: /model 写入成功后刷新缓存
- **WHEN** 用户通过 `/model` 成功将新的模型 profile id 写入 `llm.selectedModel`
- **THEN** `ModelContext` SHALL 刷新模型状态缓存
- **THEN** 后续普通 render state SHALL 能从缓存读取新 selected model 的 label 和 reasoning effort

#### Scenario: /effort 写入成功后刷新缓存
- **WHEN** 用户通过 `/effort` 成功更新当前 selected model profile 的 `reasoning.effort`
- **THEN** `ModelContext` SHALL 刷新模型状态缓存
- **THEN** 后续普通 render state SHALL 能从缓存读取新的 reasoning effort

#### Scenario: /config 保存成功后刷新缓存
- **WHEN** 用户通过 `/config` 成功保存 provider/model 配置草稿
- **THEN** `ModelContext` SHALL 刷新模型状态缓存
- **THEN** 后续普通 render state SHALL 能从缓存读取保存后的 selected model 和 reasoning effort

#### Scenario: 写入失败不更新缓存
- **WHEN** `/model`、`/effort` 或 `/config` 尝试保存模型配置但写入失败
- **THEN** `ModelContext` SHALL NOT 用未持久化的选择或 effort 更新模型状态缓存
- **THEN** UI SHALL 继续展示写入前的模型展示状态或安全错误状态

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

### Requirement: AppContext 持有 transient context usage
AppContext SHALL 持有最近一次真实 provider context usage 作为当前进程内 transient state。该状态 SHALL 参与 render state 派生，但 SHALL NOT 写入 transcript、persisted session、input history 或用户配置。

#### Scenario: 设置 context usage
- **WHEN** app 层收到 agent callback 上报的真实 context usage
- **THEN** AppContext SHALL 保存 used tokens、context window 和 usage source
- **THEN** 后续 render state SHALL 能把该 usage 传递给 status line

#### Scenario: context usage 不持久化
- **WHEN** transcript records 被保存到 session
- **THEN** context usage SHALL NOT 被写入 transcript record
- **THEN** context usage SHALL NOT 被写入 persisted session 的 compaction metadata 或其他字段

#### Scenario: 模型切换清空旧 usage
- **WHEN** 用户通过 `/model` 成功切换当前模型 profile
- **THEN** AppContext SHALL 清空已有 context usage
- **THEN** status line SHALL 在下一次真实 provider usage 到达前不显示旧模型的 context usage

#### Scenario: 清空 transcript 清空 usage
- **WHEN** 用户通过 `/clear` 清空当前 transcript
- **THEN** AppContext SHALL 清空已有 context usage

#### Scenario: 恢复 session 清空 usage
- **WHEN** 用户通过 `/resume` 恢复历史 transcript session
- **THEN** AppContext SHALL 清空已有 context usage
- **THEN** 恢复后的 status line SHALL NOT 显示恢复前进程内的旧 usage

#### Scenario: 新 turn 之前保留最近真实 usage
- **WHEN** 用户开始新的普通 assistant turn
- **AND** 新 provider usage 尚未返回
- **THEN** AppContext MAY 保留并显示上一轮最近一次真实 usage
- **THEN** 一旦新 provider usage 返回，AppContext SHALL 更新为新的 usage
