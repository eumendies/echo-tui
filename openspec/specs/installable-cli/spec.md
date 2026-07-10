# installable-cli Specification

## Purpose
定义 `echo-tui` 本地可安装 CLI 命令、普通帮助/版本输出、本地安装文档边界，以及暂不发布 npm registry 的范围。

## Requirements

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

### Requirement: 不提供 config CLI 子命令
系统 SHALL NOT 提供 `echo-tui config` 子命令。provider/model 配置体验 SHALL 通过主 UI 内 `/config` slash command 提供；CLI 层 SHALL 只保留无参数启动聊天 TUI、help、version 和 unknown command 行为。

#### Scenario: config 仍是未知命令
- **WHEN** 用户运行 `echo-tui config`
- **THEN** 系统 SHALL 输出未知命令错误和普通 CLI 帮助
- **THEN** 系统 SHALL 以非零状态退出且 SHALL NOT 创建或修改 `~/.echo/config.json`
- **THEN** CLI SHALL NOT 调用普通聊天 TUI app runner

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
