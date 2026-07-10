## MODIFIED Requirements

### Requirement: 模块边界
系统 SHALL 把 terminal、input、render、agent 和 application orchestration 代码放在不同模块中，并使用直接清晰、与真实职责一致的命名。app 层作为状态编排层，不直接组合多个底层 renderer，而是通过单一 app renderer 门面驱动渲染路径。

#### Scenario: 存在建议目录结构
- **WHEN** 实现完成
- **THEN** 项目 SHALL 包含 `bin/echo-tui.js`、`src/app/main.js`、`src/terminal/ansi.js`、`src/terminal/tty.js`、`src/input/event-types.js`、`src/input/key-parser.js`、`src/input/composer.js`、`src/render/layout.js`、`src/render/app-renderer.js`、`src/render/footer.js`、`src/render/blocks.js`、`src/agent/fake-agent.js`、`package.json`、`docs/README.md` 和 `docs/tui-architecture.md`

#### Scenario: app 层通过单一 renderer 门面触发渲染
- **WHEN** 应用运行并处理输入编辑、transcript append 或 resize destructive recovery
- **THEN** `src/app/main.js` SHALL 通过统一的 `src/render/app-renderer.js` 接口触发对应渲染路径
- **THEN** `src/app/main.js` SHALL NOT 直接组合 `footer renderer`、`blocks renderer` 或底层 `output.write` 来执行这些渲染路径

#### Scenario: app 层编排模块聚焦状态机职责
- **WHEN** 应用运行
- **THEN** `src/app/main.js` SHALL 协调 terminal setup、input parsing、composer state、transcript records、response lock、fake agent callback 和渲染事件分发
- **THEN** 具体选择 footer-only redraw、transcript append 还是 destructive full replay 的输出编排 SHALL 由 app renderer 门面负责
