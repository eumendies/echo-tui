## MODIFIED Requirements

### Requirement: CLI 帮助和版本输出
系统 SHALL 在不进入 TUI raw mode 的情况下提供普通命令行帮助和版本输出。帮助输出 SHALL 展示默认启动聊天 TUI 的用法，并 SHALL NOT 列出 `echo-tui config` 配置命令。

#### Scenario: 输出帮助
- **WHEN** 用户运行 `echo-tui --help` 或 `echo-tui -h`
- **THEN** 系统 SHALL 向 stdout 输出可用命令和常用参数说明
- **THEN** 帮助内容 SHALL NOT 包含 `echo-tui config` 命令说明
- **THEN** 系统 SHALL 正常退出且 SHALL NOT 初始化 TUI raw mode

#### Scenario: 输出版本
- **WHEN** 用户运行 `echo-tui --version` 或 `echo-tui -v`
- **THEN** 系统 SHALL 向 stdout 输出当前 package version
- **THEN** 系统 SHALL 正常退出且 SHALL NOT 初始化 TUI raw mode

## ADDED Requirements

### Requirement: 不提供 config CLI 子命令
系统 SHALL NOT 提供 `echo-tui config` 子命令。provider/model 配置体验 SHALL 通过主 UI 内 `/config` slash command 提供；CLI 层 SHALL 只保留无参数启动聊天 TUI、help、version 和 unknown command 行为。

#### Scenario: config 仍是未知命令
- **WHEN** 用户运行 `echo-tui config`
- **THEN** 系统 SHALL 输出未知命令错误和普通 CLI 帮助
- **THEN** 系统 SHALL 以非零状态退出且 SHALL NOT 创建或修改 `~/.echo/config.json`
- **THEN** CLI SHALL NOT 调用普通聊天 TUI app runner

#### Scenario: init 仍不是配置命令
- **WHEN** 用户运行 `echo-tui init`
- **THEN** 系统 SHALL 输出未知命令错误和普通 CLI 帮助
- **THEN** 系统 SHALL 以非零状态退出且 SHALL NOT 创建或修改 `~/.echo/config.json`
