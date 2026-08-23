## Context

当前 Subagent 目录由 `src/agent/subagent/catalog.ts` 在每次 primary assistant run 开始时扫描 `~/.echo/agents/*.md` 与项目根 `.echo/agents/*.md`，合并内置 `explorer`、`worker` 后冻结。自定义 manifest 使用受限 Markdown frontmatter，能够设置 description、capability、本地工具和 MCP，正文作为追加在系统基础约束后的 instructions；模型与 effort 目前直接继承父 run。

现有 command runtime 已支持 command session 独占输入、领域端口与按 `kind` 分派的 footer surface。`/memory` 提供分层 CRUD 和多行 composer，`/hooks` 提供列表、详情、字段编辑、校验与保存，`/skills` 提供模型和 effort 行内选择。这些模式可以组合，但 `/agents` 需要额外展示物理文件、有效目录和覆盖关系，不能只消费当前 `SubagentCatalog.listDescriptors()`。

本变更跨越 command、render、配置持久化、Subagent catalog 和运行时模型解析。必须保持以下边界：不引入第三方 TUI/YAML 库；工具声明只能收窄固定 capability ceiling；当前运行的 schema 与执行定义同源且不可变；内置安全定义不可被用户配置替换；不得使用 alternate screen。

## Goals / Non-Goals

**Goals:**

- 提供可发现的 `/agents` 管理入口，在 Overview、Project、User、Built-in 范围中查看来源、覆盖状态、有效性和运行策略。
- 通过明确的界面选项和 Enter 驱动创建、编辑、保存、删除与取消；新建和删除不依赖 `a`、`d` 等隐藏字符快捷键。
- 管理自定义 Agent 的 description、capability、tools、MCP、模型、effort 和 Markdown instructions，并复用运行时的严格校验规则。
- 允许内置 Explorer/Worker 在用户级或项目级设置模型与 effort，但保持其名称、描述、prompt、工具与执行策略不可修改。
- 使用同一用户配置 snapshot 严格解析 Agent 引用的模型 profile，保持下一父 run 生效及 TUI/headless 一致性。
- 对创建、更新和删除提供安全路径、原子写入与外部修改冲突保护。

**Non-Goals:**

- 不支持修改内置 Agent prompt、description、capability、工具、MCP 或委派限制。
- 不支持重命名或复制自定义 Agent；需要新名称时应显式新建，再删除旧定义。
- 不支持 Agent 启停状态、单个 MCP server/tool allowlist、任意工具名或任意 provider 凭据配置。
- 不增加目录 watcher，不原地更新当前 primary run 已冻结的 catalog。
- 不增加嵌套委派、并行调度、独立 Subagent 会话或 transcript 格式。
- 不尝试在本地判断每个具体模型支持哪些 effort 档位；provider 仍可能拒绝合法枚举。

## Decisions

### 1. 使用独立 `/agents` command session 与 `agents` surface

新增 `AgentsCommandHandler`、`CommandHostApp['agents']` 领域端口和 `AgentsCommandSurface`。Handler 持有导航、选中项、草稿、初始文件指纹、错误和确认状态；renderer 只消费深拷贝的 surface 快照。文件扫描、校验和写入只发生在 command port 后的 Agent 管理存储中，renderer 与 handler 不直接访问文件系统。

不把该功能放入 `/config`，因为 Agent 同时存在用户级、项目级、内置及覆盖/无效物理项，生命周期也不同于单个 `config.json` 草稿。独立 command 可以保持范围导航和 CRUD 的领域语义，并沿用 command 活跃时替换 composer、隐藏全局状态行的现有行为。

### 2. 所有变更动作都是可聚焦选项，不使用字符快捷键

列表内容由 Agent 行和动作行共同组成。User/Project 列表始终提供“新建 Agent”选项；自定义 Agent 详情页只提供“编辑配置”和“删除 Agent”选项；Built-in 详情只提供“配置项目级策略”和“配置用户级策略”选项。用户用方向键选中并按 Enter 进入下一步。

创建表单中的“创建 Agent…”和删除流程中的“删除 <name>”都必须再进入确认视图。确认视图提供可聚焦的“取消”与明确动作选项，默认选择“取消”；只有选择明确动作并按 Enter 才执行持久化。编辑保存沿用同样的显式 Save 选项，但普通字段修改不单独弹确认。

不提供 `a`、`d`、`e` 等字符快捷键，避免可用性依赖 footer 提示和误触。Tab/Shift+Tab 用于切换顶层范围，方向键用于导航，Space 只用于工具多选，Enter 用于激活当前可见选项，Esc 逐层取消或返回。

### 3. 管理视图同时建模物理文件和有效目录

Agent 管理端口返回两种关联数据：

- 物理项：内置定义、用户文件、项目文件及各自 sourcePath、解析结果、内容指纹和诊断。
- 有效投影：按“内置保留 > 项目 > 用户”规则形成的下一运行候选目录，标记 `active`、`shadowed`、`invalid`、`reserved`。

Overview 展示有效项及会阻止预期定义生效的关键诊断；User/Project 展示对应目录中的所有直接 `.md` 文件，包括无效、保留名称和被覆盖文件；Built-in 展示固定定义与生效的模型策略。无效文件没有可信结构化草稿，因此只允许查看诊断和删除，不由表单静默覆盖；用户可以另行创建合法名称。

### 4. 自定义 manifest 增加可选 model 与 effort 策略

受限 frontmatter 新增：

```markdown
model: reviewer-model
effort: high
```

`model` 保存 LLM model profile ID，而不是 provider/model 二元组。缺少 `model` 表示继承父 run 的 profile。`effort` 接受：

- 缺省或 `inherit`：继承父 run 的显式 effort override；父级也未覆盖时使用最终 profile 默认值。
- `default`：忽略父 effort override，使用 Agent 最终选择的 profile 默认值。
- `none | low | medium | high | xhigh | max`：使用固定 override。

序列化器输出确定字段顺序和规范化换行，正文保持 Markdown 文本。继续使用严格受限 parser，不引入通用 YAML；未知字段、重复字段、空 profile、非法 effort 或超预算输入使整个定义无效。

保存 profile ID 可以复用现有 provider、凭据、context window 和 reasoning 默认配置。相比直接保存 provider/model，这不会复制敏感或易漂移的配置语义。

### 5. 显式模型引用在同一 snapshot 中严格解析

扩展 `AgentUserConfigSnapshot` 的非敏感模型目录能力，并提供“严格 profile + 可选 effort override”的解析路径。创建父 run 的 Subagent catalog 时，使用父 run 已捕获 snapshot 验证显式 profile；不存在的 profile 产生诊断，自定义定义不进入 `run_subagent` schema，禁止宽松回退到全局或父模型。

运行时从冻结的 `SubagentDefinition` 计算最终策略：定义未指定 model 时使用父 profile；指定时使用冻结且已验证的 profile ID。effort `inherit` 传递父 override，`default` 不传 override，固定值传递明确 override。子 provider 仍由同一 snapshot 创建独立 adapter，配置文件在父 run 期间变化不会影响它。

### 6. 内置模型策略保存在独立版本化 settings 文件

内置定义没有可编辑 manifest，因此在以下位置保存非安全 override：

```text
~/.echo/agents.settings.json
<project-root>/.echo/agents.settings.json
```

格式只允许 `schemaVersion` 和 `overrides.explorer|worker`，每项只允许可选 `modelProfileId` 与 `effort`。项目级同名 override 整体遮蔽用户级 override，字段缺失表示继承父值而不是继续拼接低优先级字段，避免形成难以解释的混合策略。高优先级 override 无效时不回退低优先级 override；内置 Agent 仍保留并退回完整父模型/effort继承，同时发布诊断。

该 sidecar 不能改变内置 `SubagentDefinition` 的安全字段。Built-in 页面可分别进入项目级或用户级策略表单，并显示当前 effective 来源；删除 override 也通过明确选项和确认视图完成。

### 7. 存储层负责路径、冲突与原子性

管理存储从经过验证的 scope 和 Agent 名称构造目标路径，不接受调用方传入任意路径。它拒绝非法名称、内置保留名、目录外解析结果、符号链接和非普通文件。创建使用排他语义，不能覆盖已存在候选；更新和删除要求调用方携带打开时取得的内容指纹，执行前重新读取并比较，不一致时返回冲突且保留外部内容。

合法更新与 settings 保存使用同目录临时文件、完整写入和原子 rename；失败时尽力清理临时文件。删除只移除通过相同检查且指纹匹配的目标。成功后 command 重新扫描并显示“已保存，将在下一次 assistant turn 生效”，而不是尝试修改活动 catalog。

### 8. capability 变化会重新约束工具和 MCP

表单中的工具候选只来自 `READONLY_SUBAGENT_TOOL_CEILING` 或 `GENERAL_SUBAGENT_TOOL_CEILING`。切换到 readonly 时，草稿中超出 ceiling 的工具被标记为必须处理，MCP 强制为 false；保存前完整调用共享 manifest/definition 校验，不能依赖 renderer 裁剪。MCP 第一版只有关闭或使用父运行全部当前可用 MCP tools 两种状态。

## Risks / Trade-offs

- [完整重写 manifest 会改变用户原有 frontmatter 排版] → 使用规范化 serializer，并在确认创建/保存前展示目标路径；instructions 内容保持原始 Markdown 文本，不承诺保留注释和字段格式。
- [model profile 被删除后 Agent 从目录消失] → 在 `/agents` 中保留物理项并显示明确诊断，运行时严格失败而不静默使用错误模型。
- [内置 sidecar 增加第二种配置格式] → sidecar 仅承载内置模型策略，采用小型严格版本化 schema；自定义 Agent 仍以单个 Markdown 文件为唯一定义来源。
- [文件比较与 rename 之间仍存在极短竞态] → 在写入前检查普通文件和内容指纹，使用同目录原子替换并拒绝符号链接；不声称提供跨进程事务锁。
- [显式动作行增加操作步数] → 统一 Enter 交互和默认取消确认，换取更强的可发现性与防误操作，符合本变更的主要 UX 约束。
- [终端较小时表单内容较多] → surface 使用选中项窗口和尾部高度约束，详情字段进入独立子页面编辑，而不是在单页展开所有 tools/instructions。
- [provider 不接受某些合法 effort] → 本地只验证稳定枚举并展示该限制，真实 provider 错误沿现有子运行失败协议返回。

## Migration Plan

1. 扩展 parser 时保持旧 manifest 全部合法；缺少 model/effort 继续继承父策略，无需批量迁移。
2. settings 文件缺失按空 override 处理，Explorer/Worker 保持当前行为。
3. 先接入只读管理扫描和诊断，再启用写入与运行时策略，避免 UI 与执行规则短暂不一致。
4. 回滚时旧版本会把含 model/effort 的新 manifest 视为未知字段并拒绝，而不会用错误策略运行；删除新字段即可恢复。独立 settings 文件会被旧版本忽略。

## Open Questions

无。单个 MCP server/tool allowlist、Agent 启停和 rename 若后续需要，应分别提出变更，不在本次实现中预留可变运行时分支。
