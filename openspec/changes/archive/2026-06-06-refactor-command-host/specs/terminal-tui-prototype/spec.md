## MODIFIED Requirements

### Requirement: slash handler 显式依赖注入
系统 SHALL 在 app 装配阶段创建默认 slash command handler 实例，并通过统一 `CommandHost` 向 handler 提供其实际需要的受控 app 能力。command runtime SHALL NOT 负责从 AppContext 聚合所有 handler 可能需要的业务上下文，也 SHALL NOT 通过业务 effect 间接解释 handler 的业务动作。

#### Scenario: 默认 handler 注册不携带业务子 context
- **WHEN** app 创建默认 slash command handlers
- **THEN** `/help`、`/clear`、`/compact`、`/model` 和 `/resume` handler SHALL 使用统一 command handler 协议
- **THEN** handler SHALL NOT 通过构造期接收完整业务子 context 来绕过 `CommandHost`

#### Scenario: runtime 不拼装全量业务上下文
- **WHEN** command runtime 启动已命中的 slash handler
- **THEN** runtime SHALL 调用 handler 的命令协议方法并传递 `CommandHost`
- **THEN** runtime SHALL NOT 为该调用拼装包含 `modelCommandInfo`、`resumeSessions`、composer 文本和输入历史等所有命令业务字段的统一上下文

#### Scenario: handler 通过 host 触达 app 能力
- **WHEN** slash handler 需要读取模型信息、列出可恢复 session、重置 composer、打开或关闭 command session、清空 transcript、加载 transcript session 或触发手动压缩
- **THEN** handler SHALL 通过 `CommandHost` 的受控领域方法完成这些动作
- **THEN** handler SHALL NOT 直接驱动 renderer、terminal 或绕过 command host 访问 app 内部状态

### Requirement: slash 命令运行时
系统 SHALL 通过统一的 slash 命令运行时处理本地 slash 命令。slash 路由器 SHALL 依次询问各个命令 handler 是否命中当前已提交文本；若没有任何 handler 命中，则输入 SHALL 按普通 user message 处理。slash command handler SHALL 通过 `CommandHost` 访问受控 app 能力，而不是由 command runtime 为所有 handler 统一生成 AppContext 业务上下文或解释业务 effect。

#### Scenario: handler 命中决定 slash 路由结果
- **WHEN** 用户提交一段输入文本，且某个 slash handler 判定该文本命中自身命令
- **THEN** 系统 SHALL 将该输入路由到该 handler，而不是按普通 user message 提交

#### Scenario: 未命中任何 handler 时回退为普通消息
- **WHEN** 用户提交一段输入文本，且没有任何 slash handler 判定命中
- **THEN** 系统 SHALL 将该输入按普通 user message 提交

#### Scenario: command runtime 只负责命令运行态
- **WHEN** slash 命令启动或活跃 command session 处理输入事件
- **THEN** command runtime SHALL 负责 slash 路由、active command session、事件分发和 command surface 快照
- **THEN** command runtime SHALL NOT 为具体 handler 收集 AppContext 中的命令业务数据
- **THEN** command runtime SHALL NOT 解释 transcript、model、compaction 等业务 effect

### Requirement: 模块边界
系统 SHALL 把 terminal、input、render、agent、persistence、slash commands 和 application orchestration 代码放在不同模块中，并使用直接清晰、与真实职责一致的命名。app 层作为状态编排层，不直接组合多个底层 renderer，而是通过单一 app renderer 门面驱动渲染路径；slash 命令 SHALL 通过统一 resolver、handler、command runtime 和 `CommandHost` 集成到 app 中。Markdown inline parsing 和 Markdown table rendering SHALL 位于 render 层的独立模块中，避免 `markdown.ts` 承载过多互相独立的语法细节。

#### Scenario: 存在建议目录结构
- **WHEN** 实现完成
- **THEN** 项目 SHALL 包含 `bin/echo-tui.ts`、`src/app/main.ts`、`src/app/app-context.ts`、`src/app/command-host.ts`、`src/app/command-runtime.ts`、`src/app/composer-context.ts`、`src/app/model-context.ts`、`src/app/render-context.ts`、`src/app/slash-suggestion-context.ts`、`src/app/transcript-context.ts`、`src/app/turn-context.ts`、`src/terminal/ansi.ts`、`src/terminal/tty.ts`、`src/input/event-types.ts`、`src/input/key-parser.ts`、`src/input/composer.ts`、`src/render/layout.ts`、`src/render/app-renderer.ts`、`src/render/footer.ts`、`src/render/blocks.ts`、`src/render/markdown.ts`、`src/render/markdown-inline.ts`、`src/render/markdown-table.ts`、`src/agent/fake-agent.ts`、`src/agent/agent-loop-runtime.ts`、`src/agent/openai-agent.ts`、`src/config/llm-config.ts`、`src/commands/`、`src/persistence/transcript-store.ts`、`src/types/`、`tsconfig.json`、`package.json`、`docs/README.md` 和 `docs/tui-architecture.md`

#### Scenario: app 层通过单一 renderer 门面触发渲染
- **WHEN** 应用运行并处理输入编辑、transcript append 或 resize destructive recovery
- **THEN** `src/app/main.ts` SHALL 通过统一的 `src/render/app-renderer.ts` 接口触发对应渲染路径
- **THEN** `src/app/main.ts` SHALL NOT 直接组合 `footer renderer`、`blocks renderer` 或底层 `output.write` 来执行这些渲染路径

#### Scenario: app 层通过统一 slash 运行时协调本地命令
- **WHEN** 用户提交 slash 命令或某个命令会话处于活跃状态
- **THEN** `src/app/main.ts` SHALL 通过统一的 slash resolver、handler、command runtime 和 `CommandHost` 协调命令行为
- **THEN** `src/app/main.ts` SHALL NOT 直接为每个具体 slash 命令堆积独立的提交分支、按键分支和业务 flow 函数

#### Scenario: handler 不直接访问 transcript store
- **WHEN** `/resume` 需要展示或恢复 session
- **THEN** handler SHALL 只通过 `CommandHost` 读取 session metadata，并通过 `CommandHost` 请求 app 执行恢复
- **THEN** handler SHALL NOT 直接读取完整 transcript records 或直接调用 transcript store

#### Scenario: 实例级 AppContext 收拢 app 共享状态
- **WHEN** 应用运行
- **THEN** `src/app/main.ts` SHALL 通过实例级 `AppContext` 管理共享状态、派生上下文与基础状态操作
- **THEN** `src/app/main.ts` SHALL 聚焦于依赖装配、事件分发和顶层状态机编排，而不是持有大量共享状态局部变量

#### Scenario: app 层不提供测试专用状态快照 API
- **WHEN** 测试验证 app 状态行为
- **THEN** `src/app/main.ts` SHALL NOT 仅为了测试兼容暴露 `getState()` 之类的测试专用状态快照出口
- **THEN** 自动化测试 SHALL 适配公开行为和更合适的单元边界，而不是反向约束运行时代码接口

#### Scenario: AppContext 不替代 command runtime
- **WHEN** 应用处理 slash 命令会话
- **THEN** `src/app/command-runtime.ts` SHALL 负责命令会话和事件分发
- **THEN** `AppContext` SHALL NOT 直接吞并 command runtime 的职责边界

#### Scenario: agent 和 persistence 边界清晰
- **WHEN** agent 与 persistence 模块参与 LLM 和 transcript session 流程
- **THEN** `src/agent/agent-loop-runtime.ts` SHALL 承载 provider-neutral 真实 agent loop，`src/agent/openai-agent.ts` SHALL 承载 OpenAI provider turn adapter，`src/config/llm-config.ts` SHALL 承载用户级配置读取与校验，`src/agent/fake-agent.ts` SHALL 作为测试注入和显式开发 fixture
- **THEN** `src/persistence/transcript-store.ts` SHALL 承载本地 transcript session 存储、读取、列表派生和 atomic write
- **THEN** app 层 SHALL NOT 直接读取用户配置文件、直接调用 OpenAI SDK、直接操作 session JSON 文件或绕过 transcript store

#### Scenario: agent 和 persistence 运行行为稳定
- **WHEN** agent 与 persistence 模块处理 LLM 和 transcript session 流程
- **THEN** 真实 adapter lifecycle、fake agent callbacks、配置错误脱敏、cwd hash 分区、session JSON schema、metadata 派生和 atomic write SHALL 行为稳定
- **THEN** slash 命令、普通提交、`/resume` 恢复和 `/clear` detach session 语义 SHALL 稳定

#### Scenario: app 模块边界清晰
- **WHEN** app 模块处理顶层编排和共享状态
- **THEN** `src/app/main.ts` SHALL 负责顶层依赖装配、输入事件分发、assistant lifecycle 和 destructive resize recovery，`src/app/app-context.ts` SHALL 作为组合根门面，`src/app/command-host.ts` SHALL 承载 command 可用 app facade 和命令触发的 app 能力编排
- **THEN** `src/app/composer-context.ts`、`src/app/model-context.ts`、`src/app/render-context.ts`、`src/app/slash-suggestion-context.ts`、`src/app/transcript-context.ts` 和 `src/app/turn-context.ts` SHALL 分别承载输入历史、模型信息、渲染派生状态、composer slash suggestion、transcript/session 和 turn lifecycle 相关职责
- **THEN** `src/app/main.ts` SHALL NOT 直接持有 `SlashSuggestionContext`；该 context SHALL 由 `AppContext` 组合并通过门面暴露给顶层事件分发
- **THEN** command runtime SHALL NOT 吞并 context 职责，`main.ts` SHALL NOT 持有大量共享状态局部变量

#### Scenario: app 模块运行行为稳定
- **WHEN** app 模块处理输入事件、命令和 assistant lifecycle
- **THEN** slash command session、host 命令能力、thinking / streaming pending state、input history 浏览、transcript append/persist、resize destructive recovery 和退出 cleanup SHALL 行为稳定
- **THEN** 测试通过 `createApp(options)` 注入 fake agent、renderer、terminal、parseKey、transcriptStore 或 timer 实现时，测试注入 contract SHALL 可用

#### Scenario: render 和 terminal 保持边界清晰
- **WHEN** render 与 terminal 模块参与 app 渲染和终端控制
- **THEN** `src/render/app-renderer.ts` SHALL 作为 app 层使用的单一 renderer 门面
- **THEN** `src/terminal/ansi.ts` SHALL 只集中生成 ANSI 控制序列，`src/terminal/tty.ts` SHALL 只负责 raw mode setup/cleanup 和 terminal size 读取
- **THEN** app 层 SHALL NOT 直接组合底层 renderer、直接写 terminal 控制序列或绕过 `setupTerminal`

#### Scenario: render 和 terminal 视觉与终端行为稳定
- **WHEN** render 与 terminal 模块处理 UI 投影和终端控制
- **THEN** banner、transcript block、pending preview、footer layout、composer cursor 坐标、command surface、ANSI 样式和 display width/wrap 计算 SHALL 行为稳定
- **THEN** raw mode setup/cleanup、光标隐藏/显示、普通 footer redraw 和 resize destructive recovery SHALL 行为稳定

## REMOVED Requirements

### Requirement: slash 命令 effect interpreter
**Reason**: command 架构迁移为 `CommandHost` 命令式模型后，handler 不再通过结构化业务 effect 间接请求 app 动作，统一业务 effect interpreter 会重新造成 runtime 分支膨胀。

**Migration**: 原先通过 `CommandEffect` 描述的打开/更新/关闭 command session、重置 composer、清空 transcript、加载 session、追加 transcript record 和请求手动压缩等动作，迁移为 handler 调用 `CommandHost` 的受控领域方法。`CommandRuntime` 继续负责 active command session 与事件分发。
