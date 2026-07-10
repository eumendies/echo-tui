## ADDED Requirements

### Requirement: 可安装的 echo-tui 命令
系统 SHALL 提供名为 `echo-tui` 的 npm bin 命令，使用户在本地全局安装包后可以从任意当前工作目录启动 TUI。

#### Scenario: 全局安装后启动 TUI
- **WHEN** 用户通过 `npm link` 或 `npm install -g .` 安装当前包后在任意目录运行 `echo-tui`
- **THEN** 系统 SHALL 启动现有终端 TUI 应用
- **THEN** TUI SHALL 使用用户运行命令时的当前工作目录作为项目上下文

#### Scenario: 安装命令不依赖 TypeScript runtime
- **WHEN** 用户运行安装后的 `echo-tui` 命令
- **THEN** Node.js SHALL 执行编译后的 JavaScript bin 入口
- **THEN** 系统 SHALL NOT 要求用户安装 ts-node、tsx、自定义 loader 或 bundler runtime

### Requirement: CLI 帮助和版本输出
系统 SHALL 在不进入 TUI raw mode 的情况下提供普通命令行帮助和版本输出。

#### Scenario: 输出帮助
- **WHEN** 用户运行 `echo-tui --help` 或 `echo-tui -h`
- **THEN** 系统 SHALL 向 stdout 输出可用命令和常用参数说明
- **THEN** 系统 SHALL 正常退出且 SHALL NOT 初始化 TUI raw mode

#### Scenario: 输出版本
- **WHEN** 用户运行 `echo-tui --version` 或 `echo-tui -v`
- **THEN** 系统 SHALL 向 stdout 输出当前 package version
- **THEN** 系统 SHALL 正常退出且 SHALL NOT 初始化 TUI raw mode

### Requirement: 不提供 init 配置命令
系统 SHALL NOT 提供 `echo-tui init` 配置初始化命令；provider 和 model 配置体验 SHALL 由后续独立的 `echo-tui config` 变更承接。

#### Scenario: init 作为未知命令处理
- **WHEN** 用户运行 `echo-tui init`
- **THEN** 系统 SHALL 输出未知命令错误和普通 CLI 帮助
- **THEN** 系统 SHALL 以非零状态退出且 SHALL NOT 创建或修改 `~/.echo/config.json`

### Requirement: 暂不发布 npm registry
系统 SHALL 支持本地安装验证流程，但本变更 SHALL NOT 要求或执行 npm registry 发布。

#### Scenario: 文档说明本地安装
- **WHEN** 用户阅读安装说明
- **THEN** 文档 SHALL 展示 `npm link` 或 `npm install -g .` 的本地安装流程
- **THEN** 文档 SHALL NOT 声明当前包已经可以通过公共 npm registry 安装
- **THEN** 文档 SHALL NOT 引导用户使用 `echo-tui init`

#### Scenario: 发布流程不在本变更范围内
- **WHEN** 开发者完成本变更
- **THEN** 系统 SHALL NOT 要求配置 npm 账号、registry token、`npm publish` 自动化或公共包名发布策略
