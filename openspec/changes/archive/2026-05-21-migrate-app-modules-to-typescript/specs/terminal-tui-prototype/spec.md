## MODIFIED Requirements

### Requirement: 模块边界
系统 SHALL 把 terminal、input、render、agent、persistence、slash commands 和 application orchestration 代码放在不同模块中，并使用直接清晰、与真实职责一致的命名。app 层作为状态编排层，不直接组合多个底层 renderer，而是通过单一 app renderer 门面驱动渲染路径；slash 命令 SHALL 通过统一 resolver、handler 和 effect interpreter 集成到 app 中。

#### Scenario: 存在建议目录结构
- **WHEN** 实现完成
- **THEN** 项目 SHALL 包含 `bin/echo-tui.ts`、`src/app/main.ts`、`src/app/app-context.ts`、`src/app/command-runtime.ts`、`src/app/composer-context.ts`、`src/app/model-context.ts`、`src/app/render-context.ts`、`src/app/transcript-context.ts`、`src/app/turn-context.ts`、`src/terminal/ansi.ts`、`src/terminal/tty.ts`、`src/input/event-types.ts`、`src/input/key-parser.ts`、`src/input/composer.ts`、`src/render/layout.ts`、`src/render/app-renderer.ts`、`src/render/footer.ts`、`src/render/blocks.ts`、`src/agent/fake-agent.ts`、`src/agent/openai-agent.ts`、`src/agent/llm-config.ts`、`src/commands/`、`src/persistence/transcript-store.ts`、`src/types/`、`tsconfig.json`、`package.json`、`docs/README.md` 和 `docs/tui-architecture.md`

#### Scenario: app 层通过单一 renderer 门面触发渲染
- **WHEN** 应用运行并处理输入编辑、transcript append 或 resize destructive recovery
- **THEN** `src/app/main.ts` SHALL 通过统一的 `src/render/app-renderer.ts` 接口触发对应渲染路径
- **THEN** `src/app/main.ts` SHALL NOT 直接组合 `footer renderer`、`blocks renderer` 或底层 `output.write` 来执行这些渲染路径

#### Scenario: app 层通过统一 slash 运行时协调本地命令
- **WHEN** 用户提交 slash 命令或某个命令会话处于活跃状态
- **THEN** `src/app/main.ts` SHALL 通过统一的 slash resolver、handler 和 effect interpreter 协调命令行为
- **THEN** `src/app/main.ts` SHALL NOT 直接为每个具体 slash 命令堆积独立的提交分支和按键分支

#### Scenario: handler 不直接访问 transcript store
- **WHEN** `/resume` 需要展示或恢复 session
- **THEN** handler SHALL 只通过 command context 读取 session metadata，并通过恢复 session effect 请求 app 执行恢复
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
- **WHEN** 应用处理 slash 命令会话和 command effects
- **THEN** `src/app/command-runtime.ts` SHALL 负责命令会话、effect interpreter 和事件分发
- **THEN** `AppContext` SHALL NOT 直接吞并 command runtime 的职责边界

#### Scenario: agent 和 persistence 边界清晰
- **WHEN** agent 与 persistence 模块参与 LLM 和 transcript session 流程
- **THEN** `src/agent/openai-agent.ts` SHALL 承载真实 LLM adapter，`src/agent/llm-config.ts` SHALL 承载用户级配置读取与校验，`src/agent/fake-agent.ts` SHALL 作为测试注入和显式开发 fixture
- **THEN** `src/persistence/transcript-store.ts` SHALL 承载本地 transcript session 存储、读取、列表派生和 atomic write
- **THEN** app 层 SHALL NOT 直接读取用户配置文件、直接调用 OpenAI SDK、直接操作 session JSON 文件或绕过 transcript store

#### Scenario: agent 和 persistence 运行行为稳定
- **WHEN** agent 与 persistence 模块处理 LLM 和 transcript session 流程
- **THEN** 真实 adapter lifecycle、fake agent callbacks、配置错误脱敏、cwd hash 分区、session JSON schema、metadata 派生和 atomic write SHALL 行为稳定
- **THEN** slash 命令、普通提交、`/resume` 恢复和 `/clear` detach session 语义 SHALL 稳定

#### Scenario: app 模块边界清晰
- **WHEN** app 模块处理顶层编排和共享状态
- **THEN** `src/app/main.ts` SHALL 负责顶层依赖装配、输入事件分发、assistant lifecycle 和 destructive resize recovery，`src/app/app-context.ts` SHALL 作为组合根门面
- **THEN** `src/app/composer-context.ts`、`src/app/model-context.ts`、`src/app/render-context.ts`、`src/app/transcript-context.ts` 和 `src/app/turn-context.ts` SHALL 分别承载输入历史、模型信息、渲染派生状态、transcript/session 和 turn lifecycle 相关职责
- **THEN** command runtime SHALL NOT 吞并 context 职责，`main.ts` SHALL NOT 持有大量共享状态局部变量

#### Scenario: app 模块运行行为稳定
- **WHEN** app 模块处理输入事件、命令和 assistant lifecycle
- **THEN** slash command session、effect 解释、thinking / streaming pending state、input history 浏览、transcript append/persist、resize destructive recovery 和退出 cleanup SHALL 行为稳定
- **THEN** 测试通过 `createApp(options)` 注入 fake agent、renderer、terminal、parseKey、transcriptStore 或 timer 实现时，测试注入 contract SHALL 可用
