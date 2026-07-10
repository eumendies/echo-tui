## Context

echo-tui 现在已经有用户级配置读取、`/config` 交互式编辑、用户级和项目级 skill 发现，以及安装后的 `echo-tui` bin 入口。但首次安装体验仍依赖用户手动创建 `~/.echo/config.json` 和 skill 目录；如果没有提前配置，模型也无法通过常驻 skill catalog 获得“echo-tui 应该如何配置”的稳定说明。

现有 skill 类型只有 `project` 和 `user`，项目级 skill 会覆盖同名用户级 skill。为了避免扩大 skill registry 的概念边界，本设计把默认说明做成用户级种子 skill，而不是新增 `builtin` source kind。

## Goals / Non-Goals

**Goals:**

- 首次安装或首次运行时幂等创建 `~/.echo/`。
- 缺少 `~/.echo/config.json` 时写入最小可用默认配置，并包含 fake agent 配置。
- 缺少 `~/.echo/skills/echo-tui-setup/SKILL.md` 时写入默认 setup skill。
- 用户已有配置、已有同名 skill 和已有 skill 状态一律不覆盖。
- 安装期 bootstrap 和 TUI 首次运行 fallback 复用同一套逻辑。

**Non-Goals:**

- 不新增 `echo-tui init`、`echo-tui config` 或其他 CLI 子命令。
- 不新增 `builtin` skill source kind，也不改变现有项目级覆盖用户级的规则。
- 不在默认配置中写入真实 API key、公司内网地址或依赖用户本机路径的 MCP server。
- 不自动启用、安装或启动任何 MCP server；setup skill 只说明如何配置。

## Decisions

### Decision 1: 使用用户级种子 skill 表达“内置”说明

默认创建 `~/.echo/skills/echo-tui-setup/SKILL.md`，frontmatter 中提供 `name: echo-tui-setup` 和说明性 `description`。这样 skill registry 无需新增第三种来源，catalog 注入、`use_skill`、`/skills` 管理和 slash 直接调用都复用现有路径。

替代方案是新增 `SkillSourceKind: 'builtin'` 并在运行时从包内加载。该方案会影响类型、排序、覆盖、启用状态持久化和 `/skills` 展示规则，收益不明显，因此不采用。

### Decision 2: 默认配置以 fake agent 为核心

默认 `config.json` 应包含一个 `llm` 节点，其中 `providers.default.preset` 使用 fake agent 对应的 preset 或运行时可解析标识，`models` 至少包含一个绑定到该 provider 的 `default` model profile，`selectedModel` 指向该模型。这样新用户无需 API key 即可启动并看到 echo-tui 的 fake streaming/echo 体验，也保留项目早期“echo tui”的身份特征。

默认配置不写入真实 provider 凭据。用户后续可通过 `/config` 把默认 fake 配置替换或扩展为真实 provider/model。

### Decision 3: bootstrap 函数集中在配置/启动边界

新增一个小型 bootstrap 模块负责：解析用户目录路径、创建目录、按文件存在性写入默认配置和默认 setup skill。CLI 入口在进入 TUI 前调用该函数；安装 lifecycle script 也调用同一函数或其薄包装。

这样可以覆盖两类场景：

- 正常 `npm install -g .` 或 `npm link` 后运行 postinstall，提前创建用户目录。
- 用户或包管理器跳过 lifecycle script 时，首次 `echo-tui` 启动仍能补齐缺失文件。

### Decision 4: 幂等性以“目标文件存在即跳过”为准

bootstrap 只在目标文件不存在时创建：

- `~/.echo/config.json` 存在则不解析、不合并、不重写。
- `~/.echo/skills/echo-tui-setup/SKILL.md` 存在则不覆盖。
- `~/.echo/skills/skills.json` 不由 bootstrap 创建或修改。

该策略比配置合并更保守，避免误删用户凭据、headers、MCP server 或自定义 skill 内容。

### Decision 5: 默认 setup skill 聚焦操作说明而不是隐藏业务逻辑

`echo-tui-setup` 正文应简明说明四类内容：

- skill 安装位置和 project/user 优先级。
- MCP 配置结构：`enabled`、`servers`、`stdio/http`、`approval`、`timeoutMs`、`env`、`headers`。
- provider 配置结构：`llm.providers` 中的 `preset`、`apiKey`、`baseURL`、`headers`。
- model 配置结构：`llm.models`、`selectedModel`、`contextWindow`。

该 skill 不应包含真实 token，也不应暗示默认已安装具体 MCP server。

## Risks / Trade-offs

- [Risk] postinstall 在 npm link、不同包管理器或权限受限环境下行为不一致 → 通过首次运行 fallback 保证最终一致。
- [Risk] 自动写入用户 home 目录可能让用户意外发现新文件 → 仅创建 echo-tui 自己的 `~/.echo` 命名空间，且只在缺失时写入最小文件。
- [Risk] 默认 fake provider preset 与 `/config` preset catalog 或 agent setup 不一致 → 实现时应复用现有 provider preset/agent 解析能力，必要时补齐 fake preset 的配置面板展示与校验。
- [Risk] 后续默认 skill 内容升级不会自动覆盖旧内容 → 这是保护用户修改的取舍；如需迁移，应另行设计版本化 seed skill 更新机制。
