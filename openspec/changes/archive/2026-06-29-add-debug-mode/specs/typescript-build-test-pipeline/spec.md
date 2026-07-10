## ADDED Requirements

### Requirement: 开发者 debug 启动脚本
系统 SHALL 提供独立的 npm debug 启动脚本，使开发者可以在构建后以 debug 模式启动 TUI。普通 `npm start` SHALL 保持非 debug 启动路径。

#### Scenario: npm start 不启用 debug
- **WHEN** 开发者运行 `npm start`
- **THEN** 系统 SHALL 先生成最新 `dist/` 产物
- **THEN** 系统 SHALL 启动编译后的 TUI 入口
- **THEN** 系统 SHALL NOT 默认设置 debug 模式环境变量
- **THEN** TUI SHALL 不创建 debug 日志 writer

#### Scenario: npm start:debug 启用 debug
- **WHEN** 开发者运行 `npm start:debug`
- **THEN** 系统 SHALL 先生成最新 `dist/` 产物
- **THEN** 系统 SHALL 使用 debug 模式环境变量启动编译后的 TUI 入口
- **THEN** TUI SHALL 创建 debug 日志 writer 并写入 debug 日志

#### Scenario: debug 启动仍使用编译产物
- **WHEN** 开发者运行 `npm start:debug`
- **THEN** Node.js SHALL 执行 `dist/bin/echo-tui.js`
- **THEN** 系统 SHALL NOT 依赖 ts-node、tsx、自定义 loader 或 bundler runtime
