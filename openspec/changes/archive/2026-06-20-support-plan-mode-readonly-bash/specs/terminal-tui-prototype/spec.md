## ADDED Requirements

### Requirement: Plan mode supports readonly workspace inspection
系统 SHALL 在 plan mode 中允许模型使用只读工具和受限 readonly bash inspection 来理解代码库、工作区状态和未提交变更，同时继续禁止执行实现、修改文件或运行可能产生副作用的命令。

#### Scenario: Agent can inspect git state in plan mode
- **WHEN** 用户在 plan mode 中要求模型 review 代码变更或制定实现计划
- **THEN** 模型 SHALL 可以通过 plan mode 可用工具读取文件、搜索代码并执行允许的 readonly bash inspection 命令
- **AND** 允许的 bash inspection SHALL 包括常见 git 状态和差异查询，例如 `git status`、`git diff`、`git log`、`git show`、`git rev-parse`、`git branch --show-current`、`git ls-files` 和 `git merge-base`

#### Scenario: Plan mode still forbids execution and mutation
- **WHEN** 用户或模型尝试在 plan mode 中运行会修改工作区、修改 `.git` 状态、安装依赖、运行测试、运行构建、提交代码或执行实现计划的命令
- **THEN** 系统 SHALL 阻止该命令执行
- **AND** 系统 SHALL 告知需要先退出 plan mode 才能执行该操作

#### Scenario: Plan mode guidance mentions readonly bash boundary
- **WHEN** 系统为 plan mode 构建 provider system prompt
- **THEN** system prompt SHALL 说明当前可使用只读工具和受限 readonly bash inspection
- **AND** system prompt SHALL 明确禁止运行测试、构建、安装、提交、切换分支、重置状态或其他可能产生副作用的命令
