## ADDED Requirements

### Requirement: 用户目录自动初始化
系统 SHALL 在安装后或首次启动 TUI 前幂等创建 echo-tui 用户目录。初始化 SHALL 只创建缺失目录和文件，不得覆盖用户已有配置、已有同名 skill 或已有 skill 状态文件。

#### Scenario: 创建缺失用户目录
- **WHEN** `~/.echo` 不存在且 bootstrap 被执行
- **THEN** 系统 SHALL 创建 `~/.echo` 目录
- **THEN** 系统 SHALL 继续创建缺失的默认配置和默认 setup skill

#### Scenario: 已有用户目录不报错
- **WHEN** `~/.echo` 已存在且 bootstrap 被执行
- **THEN** 系统 SHALL 复用该目录
- **THEN** 系统 SHALL NOT 删除、重命名或清空目录中的任何已有内容

#### Scenario: 幂等执行 bootstrap
- **WHEN** bootstrap 连续执行多次
- **THEN** 第二次及后续执行 SHALL NOT 改写已存在的 `~/.echo/config.json`
- **THEN** 第二次及后续执行 SHALL NOT 改写已存在的 `~/.echo/skills/echo-tui-setup/SKILL.md`

### Requirement: 默认 fake agent 配置
系统 SHALL 在 `~/.echo/config.json` 不存在时创建默认配置文件。默认配置 SHALL 包含可运行的 fake agent 配置、默认 model profile 和 `selectedModel`，不得包含真实 API key、真实服务地址或用户本机绝对路径。

#### Scenario: 缺失 config 时创建默认配置
- **WHEN** `~/.echo/config.json` 不存在且 bootstrap 被执行
- **THEN** 系统 SHALL 创建 `~/.echo/config.json`
- **THEN** 文件内容 SHALL 包含 `llm.providers`、`llm.models` 和 `llm.selectedModel`
- **THEN** 默认 provider SHALL 使用 fake agent 配置
- **THEN** `llm.selectedModel` SHALL 引用一个已存在的默认 model profile

#### Scenario: 默认配置不需要真实凭据
- **WHEN** 系统创建默认 `~/.echo/config.json`
- **THEN** 默认配置 SHALL NOT 包含真实 API key
- **THEN** 默认配置 SHALL NOT 要求用户在首次启动前配置外部 LLM provider

#### Scenario: 已有 config 不被覆盖
- **WHEN** `~/.echo/config.json` 已存在且 bootstrap 被执行
- **THEN** 系统 SHALL NOT 修改该文件内容
- **THEN** 系统 SHALL 保留用户已有 provider、model、MCP server、headers 和其他配置节点

### Requirement: 默认 setup skill
系统 SHALL 在用户级 skill 目录中创建默认 `echo-tui-setup` skill。该 skill SHALL 说明 echo-tui 的 skill 安装、MCP 配置、provider 配置和 model 配置方式，并 SHALL 作为普通用户级 skill 被发现。

#### Scenario: 缺失 setup skill 时创建
- **WHEN** `~/.echo/skills/echo-tui-setup/SKILL.md` 不存在且 bootstrap 被执行
- **THEN** 系统 SHALL 创建该文件及其父目录
- **THEN** `SKILL.md` SHALL 包含有效 frontmatter，其中 `name` 为 `echo-tui-setup` 且包含非空 `description`

#### Scenario: setup skill 内容覆盖核心配置说明
- **WHEN** 系统创建默认 setup skill
- **THEN** skill 正文 SHALL 说明用户级和项目级 skill 的安装路径及覆盖关系
- **THEN** skill 正文 SHALL 说明 MCP `enabled`、`servers`、`transport`、`approval`、`timeoutMs`、`env` 和 `headers` 等配置字段
- **THEN** skill 正文 SHALL 说明 provider 的 `preset`、`apiKey`、`baseURL` 和 `headers` 等配置字段
- **THEN** skill 正文 SHALL 说明 model profile 的 `id`、`provider`、`model`、`contextWindow` 和 `selectedModel` 等配置字段

#### Scenario: 已有 setup skill 不被覆盖
- **WHEN** `~/.echo/skills/echo-tui-setup/SKILL.md` 已存在且 bootstrap 被执行
- **THEN** 系统 SHALL NOT 修改该文件内容
- **THEN** 系统 SHALL 保留用户对该 skill 的自定义说明

#### Scenario: bootstrap 不修改 skill 状态
- **WHEN** `~/.echo/skills/skills.json` 已存在且 bootstrap 被执行
- **THEN** 系统 SHALL NOT 修改该状态文件
- **THEN** setup skill 的 enabled/disabled 状态 SHALL 继续由现有 skill 状态规则决定

