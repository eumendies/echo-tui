## ADDED Requirements

### Requirement: 启动前用户目录 fallback 初始化
安装后的 `echo-tui` 命令 SHALL 在进入 TUI raw mode 和启动普通聊天应用前执行用户目录 bootstrap fallback。该 fallback SHALL 与安装期初始化语义一致，并 SHALL NOT 改变 help、version 或 unknown command 行为。

#### Scenario: 启动 TUI 前补齐用户目录
- **WHEN** 用户运行安装后的 `echo-tui` 命令且没有传入 help、version 或未知子命令参数
- **THEN** 系统 SHALL 在启动 TUI 前执行用户目录 bootstrap
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

### Requirement: 安装期用户目录初始化
包安装生命周期 SHALL 尝试执行用户目录 bootstrap，使本地全局安装后默认配置和默认 setup skill 可提前存在。安装期初始化失败 SHALL NOT 影响后续首次运行 fallback 的幂等补齐能力。

#### Scenario: 安装后创建默认用户文件
- **WHEN** 用户通过支持 lifecycle script 的方式安装 echo-tui 包
- **THEN** 安装期 bootstrap SHALL 尝试创建 `~/.echo`、默认 `config.json` 和默认 setup skill
- **THEN** 已存在的用户文件 SHALL NOT 被覆盖

#### Scenario: 跳过安装脚本后首次运行补齐
- **WHEN** 包管理器跳过安装 lifecycle script
- **AND** 用户首次运行 `echo-tui`
- **THEN** 启动前 fallback SHALL 创建缺失的默认用户文件

