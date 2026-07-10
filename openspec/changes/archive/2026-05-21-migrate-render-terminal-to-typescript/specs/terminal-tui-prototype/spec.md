## MODIFIED Requirements

### Requirement: 模块边界
系统 SHALL 把 terminal、input、render、agent、persistence、slash commands 和 application orchestration 代码放在不同模块中，并使用直接清晰、与真实职责一致的命名。app 层作为状态编排层，不直接组合多个底层 renderer，而是通过单一 app renderer 门面驱动渲染路径；slash 命令 SHALL 通过统一 resolver、handler 和 effect interpreter 集成到 app 中。

#### Scenario: 存在建议目录结构
- **WHEN** 实现完成
- **THEN** 项目 SHALL 包含 `bin/echo-tui.js`、`src/app/main.js`、`src/app/app-context.js`、`src/terminal/ansi.ts`、`src/terminal/tty.ts`、`src/input/event-types.ts`、`src/input/key-parser.ts`、`src/input/composer.ts`、`src/render/layout.ts`、`src/render/app-renderer.ts`、`src/render/footer.ts`、`src/render/blocks.ts`、`src/agent/fake-agent.js`、`src/agent/openai-agent.js`、`src/commands/`、`src/persistence/transcript-store.js`、`src/types/`、`tsconfig.json`、`package.json`、`docs/README.md` 和 `docs/tui-architecture.md`

#### Scenario: app 层通过单一 renderer 门面触发渲染
- **WHEN** 应用运行并处理输入编辑、transcript append 或 resize destructive recovery
- **THEN** `src/app/main.js` SHALL 通过统一的 `src/render/app-renderer.ts` 接口触发对应渲染路径
- **THEN** `src/app/main.js` SHALL NOT 直接组合 `footer renderer`、`blocks renderer` 或底层 `output.write` 来执行这些渲染路径

#### Scenario: app 层通过统一 slash 运行时协调本地命令
- **WHEN** 用户提交 slash 命令或某个命令会话处于活跃状态
- **THEN** `src/app/main.js` SHALL 通过统一的 slash resolver、handler 和 effect interpreter 协调命令行为
- **THEN** `src/app/main.js` SHALL NOT 直接为每个具体 slash 命令堆积独立的提交分支和按键分支

#### Scenario: handler 不直接访问 transcript store
- **WHEN** `/resume` 需要展示或恢复 session
- **THEN** handler SHALL 只通过 command context 读取 session metadata，并通过恢复 session effect 请求 app 执行恢复
- **THEN** handler SHALL NOT 直接读取完整 transcript records 或直接调用 transcript store

#### Scenario: 实例级 AppContext 收拢 app 共享状态
- **WHEN** 应用运行
- **THEN** `src/app/main.js` SHALL 通过实例级 `AppContext` 管理共享状态、派生上下文与基础状态操作
- **THEN** `src/app/main.js` SHALL 聚焦于依赖装配、事件分发和顶层状态机编排，而不是继续持有大量共享状态局部变量

#### Scenario: app 层不为测试保留专用状态快照 API
- **WHEN** `AppContext` 重构完成
- **THEN** `src/app/main.js` SHALL NOT 仅为了测试兼容继续保留 `getState()` 之类的测试专用状态快照出口
- **THEN** 自动化测试 SHALL 适配公开行为和更合适的单元边界，而不是反向约束运行时代码接口

#### Scenario: AppContext 不替代 command runtime
- **WHEN** 应用处理 slash 命令会话和 command effects
- **THEN** `src/app/command-runtime.js` SHALL 继续负责命令会话、effect interpreter 和事件分发
- **THEN** `AppContext` SHALL NOT 直接吞并 command runtime 的职责边界

#### Scenario: render 和 terminal 迁移保持边界不变
- **WHEN** render 与 terminal 模块迁移为 TypeScript
- **THEN** `src/render/app-renderer.ts` SHALL 继续作为 app 层使用的单一 renderer 门面
- **THEN** `src/terminal/ansi.ts` SHALL 继续只集中生成 ANSI 控制序列，`src/terminal/tty.ts` SHALL 继续只负责 raw mode setup/cleanup 和 terminal size 读取
- **THEN** 迁移 SHALL NOT 让 app 层直接组合底层 renderer、直接写 terminal 控制序列或绕过 `setupTerminal`

#### Scenario: render 和 terminal 迁移保持视觉与终端行为
- **WHEN** render 与 terminal 模块迁移为 TypeScript
- **THEN** banner、transcript block、pending preview、footer layout、composer cursor 坐标、command surface、ANSI 样式和 display width/wrap 计算 SHALL 保持现有行为
- **THEN** raw mode setup/cleanup、光标隐藏/显示、普通 footer redraw 和 resize destructive recovery SHALL 保持现有行为
