## MODIFIED Requirements

### Requirement: 模块边界
系统 SHALL 把 terminal、input、render、agent、persistence、slash commands 和 application orchestration 代码放在不同模块中，并使用直接清晰、与真实职责一致的命名。app 层作为状态编排层，不直接组合多个底层 renderer，而是通过单一 app renderer 门面驱动渲染路径；slash 命令 SHALL 通过统一 resolver、handler、command runtime 和 `CommandHost` 集成到 app 中。Markdown inline parsing 和 Markdown table rendering SHALL 位于 render 层的独立模块中，避免 `markdown.ts` 承载过多互相独立的语法细节。render 层内部 SHALL 按投影职责拆分：稳定 transcript 投影、assistant/reasoning 运行期投影与 shell 运行期投影各自独立成模块，命名与实际渲染职责一致；运行期确定状态机 SHALL NOT 与消息行渲染 primitives 混放在同一模块。

#### Scenario: 存在建议目录结构
- **WHEN** 实现完成
- **THEN** 项目 SHALL 包含 `bin/echo-tui.ts`、`src/app/main.ts`、`src/app/state/app-context.ts`、`src/app/command/command-host.ts`、`src/app/command/command-runtime.ts`、`src/app/state/composer-context.ts`、`src/app/state/model-context.ts`、`src/app/state/render-context.ts`、`src/app/state/slash-suggestion-context.ts`、`src/app/state/transcript-context.ts`、`src/app/state/turn-context.ts`、`src/terminal/ansi.ts`、`src/terminal/tty.ts`、`src/input/event-types.ts`、`src/input/key-parser.ts`、`src/input/composer.ts`、`src/render/layout.ts`、`src/render/app-renderer.ts`、`src/render/footer.ts`、`src/render/blocks.ts`、`src/render/transcript-renderer.ts`、`src/render/live/streaming-renderer.ts`、`src/render/live/shell-renderer.ts`、`src/render/markdown.ts`、`src/render/markdown-inline.ts`、`src/render/markdown-table.ts`、`src/agent/fake/agent.ts`、`src/agent/loop-runtime/agent-loop-runtime.ts`、`src/agent/loop-runtime/subagent-loop-runtime.ts`、`src/agent/loop-runtime/shared.ts`、`src/agent/openai-responses/agent.ts`、`src/agent/openai-chat/agent.ts`、`src/agent/anthropic/agent.ts`、`src/agent/codex/agent.ts`、`src/config/llm-config.ts`、`src/commands/`、`src/persistence/transcript-store.ts`、`src/types/`、`tsconfig.json`、`package.json`、`README.md` 和 `docs/tui-architecture.md`

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
- **THEN** `src/app/command/command-runtime.ts` SHALL 负责命令会话和事件分发
- **THEN** `AppContext` SHALL NOT 直接吞并 command runtime 的职责边界

#### Scenario: agent 和 persistence 边界清晰
- **WHEN** agent 与 persistence 模块参与 LLM 和 transcript session 流程
- **THEN** `src/agent/loop-runtime/agent-loop-runtime.ts` 与 `src/agent/loop-runtime/subagent-loop-runtime.ts` SHALL 分别承载 provider-neutral 主 agent loop和子 agent loop，`src/agent/openai-responses/agent.ts`、`src/agent/openai-chat/agent.ts`、`src/agent/anthropic/agent.ts` 和 `src/agent/codex/agent.ts` SHALL 承载具体 provider turn adapter，`src/config/llm-config.ts` SHALL 承载用户级配置读取与校验，`src/agent/fake/agent.ts` SHALL 作为测试注入和显式开发 fixture
- **THEN** `src/persistence/transcript-store.ts` SHALL 承载本地 transcript session 存储、读取、列表派生和 atomic write
- **THEN** app 层 SHALL NOT 直接读取用户配置文件、直接调用 OpenAI SDK、直接操作 session JSON 文件或绕过 transcript store

#### Scenario: agent 和 persistence 运行行为稳定
- **WHEN** agent 与 persistence 模块处理 LLM 和 transcript session 流程
- **THEN** 真实 adapter lifecycle、fake agent callbacks、配置错误脱敏、cwd hash 分区、session JSON schema、metadata 派生和 atomic write SHALL 行为稳定
- **THEN** slash 命令、普通提交、`/resume` 恢复和 `/clear` detach session 语义 SHALL 稳定

#### Scenario: app 模块边界清晰
- **WHEN** app 模块处理顶层编排和共享状态
- **THEN** `src/app/main.ts` SHALL 负责顶层依赖装配、输入事件分发、assistant lifecycle 和 destructive resize recovery，`src/app/state/app-context.ts` SHALL 作为组合根门面，`src/app/command/command-host.ts` SHALL 承载 command 可用 app facade 和命令触发的 app 能力编排
- **THEN** `src/app/state/composer-context.ts`、`src/app/state/model-context.ts`、`src/app/state/render-context.ts`、`src/app/state/slash-suggestion-context.ts`、`src/app/state/transcript-context.ts` 和 `src/app/state/turn-context.ts` SHALL 分别承载输入历史、模型信息、渲染派生状态、composer slash suggestion、transcript/session 和 turn lifecycle 相关职责
- **THEN** `src/app/main.ts` SHALL NOT 直接持有 `SlashSuggestionContext`；该 context SHALL 由 `AppContext` 组合并通过门面暴露给顶层事件分发
- **THEN** command runtime SHALL NOT 吞并 context 职责，`main.ts` SHALL NOT 持有大量共享状态局部变量

#### Scenario: app 模块运行行为稳定
- **WHEN** app 模块处理输入事件、命令和 assistant lifecycle
- **THEN** slash command session、host 命令能力、thinking / streaming pending state、input history 浏览、transcript append/persist、resize destructive recovery 和退出 cleanup SHALL 行为稳定
- **THEN** 自动化测试 SHALL 通过 assistant turn runner、command runtime、renderer、input parser、agent loop runtime 或其他公开模块 seam 覆盖行为，而不是依赖测试专用 app options

#### Scenario: render 和 terminal 保持边界清晰
- **WHEN** render 与 terminal 模块参与 app 渲染和终端控制
- **THEN** `src/render/app-renderer.ts` SHALL 作为 app 层使用的单一 renderer 门面
- **THEN** `src/terminal/ansi.ts` SHALL 只集中生成 ANSI 控制序列，`src/terminal/tty.ts` SHALL 只负责 raw mode setup/cleanup 和 terminal size 读取
- **THEN** app 层 SHALL NOT 直接组合底层 renderer、直接写 terminal 控制序列或绕过 `setupTerminal`

#### Scenario: render 内部模块按职责拆分
- **WHEN** 开发者阅读 render 层模块
- **THEN** `src/render/app-renderer.ts` SHALL 只作为组合门面实现 `AppRenderer` 契约并装配各投影模块
- **THEN** transcript 分组与 role dispatch SHALL 位于 `src/render/transcript-renderer.ts`，assistant/reasoning 运行期增量确定 SHALL 位于 `src/render/live/streaming-renderer.ts`，shell 运行期增量确定 SHALL 位于 `src/render/live/shell-renderer.ts`
- **THEN** `src/render/blocks.ts` SHALL 只承载消息行与 block 渲染 primitives，不承载运行期确定状态机

#### Scenario: render 和 terminal 视觉与终端行为稳定
- **WHEN** render 与 terminal 模块处理 UI 投影和终端控制
- **THEN** banner、transcript block、pending preview、footer layout、composer cursor 坐标、command surface、ANSI 样式和 display width/wrap 计算 SHALL 行为稳定
- **THEN** raw mode setup/cleanup、光标隐藏/显示、普通 footer redraw 和 resize destructive recovery SHALL 行为稳定

#### Scenario: render 模块拆分不改变可见行为
- **WHEN** render 层模块按职责拆分完成后应用运行
- **THEN** 可见输出、终端控制序列、transcript/persistence 格式和 provider 投影 SHALL 与拆分前逐字节一致
- **THEN** `AppRenderer` 契约与 `createAppRenderer` 导出位置 SHALL 保持不变
