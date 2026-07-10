# app-mode-command Specification

## Purpose
定义 `echo_tui` app interaction mode command 的外部行为，包括通过 `/mode` 查看和切换 normal、plan、shell、shell-local 四种模式，并替代旧的 `/plan` command。
## Requirements
### Requirement: Mode command switches interaction modes
系统 SHALL 提供 `/mode` slash command，用于查看和切换 normal、plan、shell、shell-local 四种 interaction mode。该命令 SHALL 替代 `/plan`，并 SHALL 直接更新当前 interaction mode。

#### Scenario: Open mode selection surface
- **WHEN** 用户提交 `/mode`
- **THEN** 系统 SHALL 打开 mode 选择 surface
- **AND** surface SHALL 列出 normal、plan、shell、shell-local 四种模式及简短说明
- **AND** surface SHALL 标记当前 interaction mode 为选中项

#### Scenario: Select mode from surface
- **WHEN** `/mode` 选择 surface 处于活跃状态且用户按 Up 或 Down
- **THEN** 系统 SHALL 移动当前选中项
- **WHEN** 用户按 Enter
- **THEN** 系统 SHALL 切换到选中的 interaction mode
- **AND** 系统 SHALL 关闭 surface 并清空 composer

#### Scenario: Set mode directly by argument
- **WHEN** 用户提交 `/mode normal`、`/mode plan`、`/mode shell` 或 `/mode shell-local`
- **THEN** 系统 SHALL 直接切换到对应 interaction mode
- **AND** 系统 SHALL NOT 打开选择 surface

#### Scenario: Shell modes define context behavior
- **WHEN** 用户切换到 `/mode shell`
- **THEN** 系统 SHALL 设置 interaction mode 为 shell
- **AND** shell 命令结果 SHALL 进入模型上下文
- **WHEN** 用户切换到 `/mode shell-local`
- **THEN** 系统 SHALL 设置 interaction mode 为 shell-local
- **AND** shell 命令结果 SHALL 仅本地显示，不进入模型上下文

#### Scenario: Reject invalid mode argument
- **WHEN** 用户提交不支持的 mode 参数，例如 `/mode maybe`
- **THEN** 系统 SHALL 打开 usage info surface
- **AND** usage SHALL 展示 `/mode` 以及四个受支持的直接切换命令

#### Scenario: Plan command is removed
- **WHEN** 用户提交 `/plan`、`/plan on` 或 `/plan off`
- **THEN** 系统 SHALL NOT 将其识别为本地 slash command
- **AND** slash suggestion SHALL NOT 展示 `/plan`

#### Scenario: Tab mode cycle remains unchanged
- **WHEN** 用户在非响应中按 Tab
- **THEN** 系统 SHALL 继续按 normal、plan、shell、shell-local、normal 的顺序循环切换 interaction mode
