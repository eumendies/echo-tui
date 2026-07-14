## MODIFIED Requirements

### Requirement: CLI 帮助和版本输出
系统 SHALL 在不进入 TUI raw mode 的情况下提供普通命令行帮助和版本输出。帮助输出 SHALL 展示默认启动聊天 TUI 的用法、`echo-tui --once <prompt>` 单轮用法和可选 `--full-access` 风险提示，并 SHALL NOT 列出 `echo-tui config` 配置命令。

#### Scenario: 输出帮助
- **WHEN** 用户运行 `echo-tui --help` 或 `echo-tui -h`
- **THEN** 系统 SHALL 向 stdout 输出可用命令和常用参数说明
- **THEN** 帮助内容 SHALL 包含 `--once <prompt>` 用法
- **THEN** 帮助内容 SHALL 说明 `--full-access` 仅用于单轮模式且可能执行写入或高风险操作
- **THEN** 帮助内容 SHALL NOT 包含 `echo-tui config` 命令说明
- **THEN** 系统 SHALL 正常退出且 SHALL NOT 初始化 TUI raw mode

#### Scenario: 输出版本
- **WHEN** 用户运行 `echo-tui --version` 或 `echo-tui -v`
- **THEN** 系统 SHALL 向 stdout 输出当前 package version
- **THEN** 系统 SHALL 正常退出且 SHALL NOT 初始化 TUI raw mode

### Requirement: 不提供 config CLI 子命令
系统 SHALL NOT 提供 `echo-tui config` 子命令。provider/model 配置体验 SHALL 通过主 UI 内 `/config` slash command 提供；CLI 层 SHALL 保留无参数启动聊天 TUI、`--once` 单轮对话、help、version 和 unknown command 行为。

#### Scenario: config 仍是未知命令
- **WHEN** 用户运行 `echo-tui config`
- **THEN** 系统 SHALL 输出未知命令错误和普通 CLI 帮助
- **THEN** 系统 SHALL 以非零状态退出且 SHALL NOT 创建或修改 `~/.echo/config.json`
- **THEN** CLI SHALL NOT 调用普通聊天 TUI app runner 或单轮 agent runner

#### Scenario: init 作为未知命令处理
- **WHEN** 用户运行 `echo-tui init`
- **THEN** 系统 SHALL 输出未知命令错误和普通 CLI 帮助
- **THEN** 系统 SHALL 以非零状态退出且 SHALL NOT 创建或修改 `~/.echo/config.json`

### Requirement: 启动前用户目录 fallback 初始化
安装后的 `echo-tui` 命令 SHALL 在进入 TUI raw mode、启动普通聊天应用或启动单轮 agent runner 前执行用户目录 bootstrap fallback。该 fallback SHALL 与安装期初始化语义一致，并 SHALL NOT 改变 help、version 或 unknown command 行为。

#### Scenario: 启动 TUI 或单轮前补齐用户目录
- **WHEN** 用户运行安装后的 `echo-tui` 命令且没有传入 help、version 或未知子命令参数
- **AND** 用户选择无参数 TUI 启动或有效的 `--once <prompt>` 单轮启动
- **THEN** 系统 SHALL 在启动对应运行时前执行用户目录 bootstrap
- **THEN** 缺失的 `~/.echo/config.json` 和 `~/.echo/skills/echo-tui-setup/SKILL.md` SHALL 按默认规则创建

#### Scenario: help 不执行 bootstrap
- **WHEN** 用户运行 `echo-tui --help` 或 `echo-tui -h`
- **THEN** 系统 SHALL 输出帮助并退出
- **THEN** 系统 SHALL NOT 因 help 命令创建或修改 `~/.echo/config.json`

#### Scenario: version 不执行 bootstrap
- **WHEN** 用户运行 `echo-tui --version` 或 `echo-tui -v`
- **THEN** 系统 SHALL 输出版本并退出
- **THEN** 系统 SHALL NOT 因 version 命令创建或修改 `~/.echo/config.json`

#### Scenario: unknown command 不执行 bootstrap
- **WHEN** 用户运行未知 CLI 子命令，例如 `echo-tui init` 或 `echo-tui config`
- **THEN** 系统 SHALL 输出未知命令错误并以非零状态退出
- **THEN** 系统 SHALL NOT 因未知命令创建或修改 `~/.echo/config.json`
