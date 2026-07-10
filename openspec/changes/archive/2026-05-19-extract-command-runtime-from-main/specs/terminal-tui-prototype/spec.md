## MODIFIED Requirements

### Requirement: 模块边界
系统 SHALL 把 terminal、input、render、agent、slash commands、app command runtime 和 application orchestration 代码放在不同模块中，并使用直接清晰、与真实职责一致的命名。app 层作为状态编排层，不直接组合多个底层 renderer，而是通过单一 app renderer 门面驱动渲染路径；slash 命令 SHALL 通过统一 resolver、handler 和独立 app command runtime 集成到 app 中。

#### Scenario: 存在建议目录结构
- **WHEN** 实现完成
- **THEN** 项目 SHALL 包含 `bin/echo-tui.js`、`src/app/main.js`、`src/app/command-runtime.js`、`src/terminal/ansi.js`、`src/terminal/tty.js`、`src/input/event-types.js`、`src/input/key-parser.js`、`src/input/composer.js`、`src/render/layout.js`、`src/render/app-renderer.js`、`src/render/footer.js`、`src/render/blocks.js`、`src/agent/fake-agent.js`、`src/commands/`、`package.json`、`docs/README.md` 和 `docs/tui-architecture.md`

#### Scenario: app 层通过单一 renderer 门面触发渲染
- **WHEN** 应用运行并处理输入编辑、transcript append 或 resize destructive recovery
- **THEN** `src/app/main.js` SHALL 通过统一的 `src/render/app-renderer.js` 接口触发对应渲染路径
- **THEN** `src/app/main.js` SHALL NOT 直接组合 `footer renderer`、`blocks renderer` 或底层 `output.write` 来执行这些渲染路径

#### Scenario: app 层通过独立 command runtime 协调本地命令
- **WHEN** 用户提交 slash 命令或某个命令会话处于活跃状态
- **THEN** `src/app/main.js` SHALL 通过 `src/app/command-runtime.js` 协调命令行为
- **THEN** `src/app/command-runtime.js` SHALL 通过统一 slash resolver、handler 和 effect interpreter 管理 command session、session config 和命令事件分发
- **THEN** `src/app/main.js` SHALL NOT 直接为每个具体 slash 命令堆积独立的提交分支和按键分支
- **THEN** `src/app/main.js` SHALL NOT 内联 slash command effect interpreter 的实现细节

#### Scenario: app 层编排模块聚焦状态机职责
- **WHEN** 应用运行
- **THEN** `src/app/main.js` SHALL 协调 terminal setup、input parsing、composer state、transcript records、response lock、fake agent callback、command runtime 和渲染事件分发
- **THEN** 具体选择 footer-only redraw、transcript append 还是 destructive full replay 的输出编排 SHALL 由 app renderer 门面负责
