## Why

首次安装或首次运行 `echo-tui` 时，用户目前需要手动理解并创建 `~/.echo/config.json`、skill 目录和 MCP/provider/model 配置，导致模型也无法稳定获得项目自带的配置说明。这个变更把“如何配置 echo-tui”沉淀为默认用户级 skill，并在安装/启动时自动完成最小可用用户目录初始化。

## What Changes

- 安装后或首次启动 TUI 前，系统会幂等创建 `~/.echo/` 用户目录。
- 当 `~/.echo/config.json` 不存在时，系统会写入一个默认配置文件；默认配置必须包含可直接体现 echo-tui 起源的 fake agent 配置，而不是空配置骨架。
- 当 `~/.echo/skills/echo-tui-setup/SKILL.md` 不存在时，系统会写入一个默认用户级 setup skill，说明 skill 安装、MCP 配置、provider 配置和 model 配置方式。
- 默认 bootstrap 只创建缺失文件和目录，不覆盖用户已有 `config.json`、已有同名 skill 或已有 skill 状态。
- 安装期 bootstrap 和 TUI 首次运行 fallback 复用同一套初始化语义，避免 package manager 跳过 lifecycle script 时失效。

## Capabilities

### New Capabilities
- `echo-user-bootstrap`: 定义 echo-tui 用户目录、默认 fake agent 配置和默认 setup skill 的自动初始化行为。

### Modified Capabilities
- `installable-cli`: 安装后的 `echo-tui` 命令需要具备首次运行 fallback 初始化用户目录和默认配置的行为。
- `skill-system`: skill 系统需要把默认 setup skill 作为用户级种子 skill 发现和加载，而不是新增第三种 builtin skill source。
- `interactive-llm-config-command`: 默认生成的配置文件需要与现有 `/config` 管理的 provider/model 配置结构兼容，并保留后续用户编辑能力。
- `mcp-tool-integration`: setup skill 需要文档化用户级 MCP 配置结构和审批/timeout 等关键字段。

## Impact

- 影响 CLI 安装/启动入口、用户配置 bootstrap 逻辑、默认配置模板、默认 skill 模板和相关测试。
- 不引入新的 skill source kind；仍沿用 `user` / `project` 两级发现和覆盖规则。
- 不引入新的 CLI 子命令，不改变 `/config`、`/skills`、MCP runtime 和 provider adapter 的既有运行时协议。
- 需要新增或更新自动化测试，验证缺失文件创建、已有文件不覆盖、默认 fake agent 配置和默认 setup skill 可被发现。
