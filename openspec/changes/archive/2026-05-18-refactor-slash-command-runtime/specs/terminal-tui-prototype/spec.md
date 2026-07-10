## ADDED Requirements

### Requirement: slash 命令运行时
系统 SHALL 通过统一的 slash 命令运行时处理本地 slash 命令。slash 路由器 SHALL 依次询问各个命令 handler 是否命中当前已提交文本；若没有任何 handler 命中，则输入 SHALL 按普通 user message 处理。

#### Scenario: handler 命中决定 slash 路由结果
- **WHEN** 用户提交一段输入文本，且某个 slash handler 判定该文本命中自身命令
- **THEN** 系统 SHALL 将该输入路由到该 handler，而不是按普通 user message 提交

#### Scenario: 未命中任何 handler 时回退为普通消息
- **WHEN** 用户提交一段输入文本，且没有任何 slash handler 判定命中
- **THEN** 系统 SHALL 将该输入按普通 user message 提交

### Requirement: slash 命令 effect interpreter
slash 命令 handler SHALL 通过结构化 effect 请求系统执行动作，而不是直接修改 app 状态或直接驱动 renderer。系统 SHALL 由统一的 effect interpreter 执行这些命令效果。

#### Scenario: handler 通过 effect 打开命令会话
- **WHEN** 某个交互式 slash 命令被启动
- **THEN** 对应 handler SHALL 返回打开 command session 的 effect
- **THEN** 系统 SHALL 由统一的 effect interpreter 执行该 effect，并进入对应的命令会话

#### Scenario: handler 通过 effect 追加 transcript 或更新会话配置
- **WHEN** 某个 slash 命令需要向 transcript 输出结果，或更新 session 级配置
- **THEN** 对应 handler SHALL 通过 effect 描述这些动作
- **THEN** 系统 SHALL 由统一的 effect interpreter 执行这些 effect，而不是要求 handler 直接写 transcript 或直接修改 app 状态

## MODIFIED Requirements

### Requirement: slash help overlay
系统 SHALL 支持一个最小版的本地 slash 帮助命令：当用户提交纯 `/help` 时，在 composer/footer 区域显示临时 help overlay，用于展示当前可用按键说明。该命令 SHALL 集成到统一的 slash 命令运行时下，但其用户可见行为保持不变。

#### Scenario: 纯 /help 打开 help overlay
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/help`
- **THEN** 系统 SHALL 进入 help overlay 状态
- **THEN** 系统 SHALL 在 composer/footer 区域显示帮助内容，而不是把帮助文本追加到 transcript

#### Scenario: help overlay 不走 transcript、历史和 agent 生命周期
- **WHEN** 系统因纯 `/help` 进入 help overlay 状态
- **THEN** 系统 SHALL NOT 追加新的 user transcript record 或 assistant transcript record
- **THEN** 系统 SHALL NOT 把 `/help` 写入当前 session 的输入历史
- **THEN** 系统 SHALL NOT 启动 fake agent 的 thinking 或 streaming 生命周期

#### Scenario: Esc 关闭 help overlay
- **WHEN** help overlay 处于活跃状态且用户按下 Esc
- **THEN** 系统 SHALL 退出 help overlay 状态
- **THEN** 系统 SHALL 恢复普通 composer 输入界面，并让 composer 为空

### Requirement: 模块边界
系统 SHALL 把 terminal、input、render、agent、slash commands 和 application orchestration 代码放在不同模块中，并使用直接清晰、与真实职责一致的命名。app 层作为状态编排层，不直接组合多个底层 renderer，而是通过单一 app renderer 门面驱动渲染路径；slash 命令 SHALL 通过统一 resolver、handler 和 effect interpreter 集成到 app 中。

#### Scenario: 存在建议目录结构
- **WHEN** 实现完成
- **THEN** 项目 SHALL 包含 `bin/echo-tui.js`、`src/app/main.js`、`src/terminal/ansi.js`、`src/terminal/tty.js`、`src/input/event-types.js`、`src/input/key-parser.js`、`src/input/composer.js`、`src/render/layout.js`、`src/render/app-renderer.js`、`src/render/footer.js`、`src/render/blocks.js`、`src/agent/fake-agent.js`、`src/commands/`、`package.json`、`docs/README.md` 和 `docs/tui-architecture.md`

#### Scenario: app 层通过单一 renderer 门面触发渲染
- **WHEN** 应用运行并处理输入编辑、transcript append 或 resize destructive recovery
- **THEN** `src/app/main.js` SHALL 通过统一的 `src/render/app-renderer.js` 接口触发对应渲染路径
- **THEN** `src/app/main.js` SHALL NOT 直接组合 `footer renderer`、`blocks renderer` 或底层 `output.write` 来执行这些渲染路径

#### Scenario: app 层通过统一 slash 运行时协调本地命令
- **WHEN** 用户提交 slash 命令或某个命令会话处于活跃状态
- **THEN** `src/app/main.js` SHALL 通过统一的 slash resolver、handler 和 effect interpreter 协调命令行为
- **THEN** `src/app/main.js` SHALL NOT 直接为每个具体 slash 命令堆积独立的提交分支和按键分支

#### Scenario: app 层编排模块聚焦状态机职责
- **WHEN** 应用运行
- **THEN** `src/app/main.js` SHALL 协调 terminal setup、input parsing、composer state、transcript records、response lock、fake agent callback、slash command session 和渲染事件分发
- **THEN** 具体选择 footer-only redraw、transcript append 还是 destructive full replay 的输出编排 SHALL 由 app renderer 门面负责
