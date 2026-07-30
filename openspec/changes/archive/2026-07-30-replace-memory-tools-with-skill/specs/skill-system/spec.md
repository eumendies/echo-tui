## ADDED Requirements

### Requirement: Built-in skill 资源随应用版本发布
系统 SHALL 将 built-in skill 的 `SKILL.md`、`reference/`（如有）和 `scripts/` 资源复制到编译产物并包含在 npm 发布包中。Built-in skill 的 source path SHALL 基于当前安装包位置解析，不得依赖固定 npm 前缀、当前工作目录或复制到用户目录的陈旧副本。

#### Scenario: 构建产物包含 agent-memory skill
- **WHEN** 项目完成生产构建或生成 npm 发布包
- **THEN** `dist/src` SHALL 包含具有完整操作协议的 `agent-memory/SKILL.md` 和 CommonJS 脚本
- **THEN** npm 包文件清单 SHALL 包含这些资源

#### Scenario: 从 npm 安装目录加载资源
- **WHEN** echo-tui 通过局部、全局或链接式 npm 安装运行
- **THEN** skill registry SHALL 从实际包目录发现 built-in `agent-memory`
- **THEN** `use_skill` SHALL 返回该安装目录下的 source path 和稳定相对资源清单

## MODIFIED Requirements

### Requirement: skill 文件发现和元数据解析
系统 SHALL 从应用包内 built-in skill root、用户级 `~/.echo/skills/<skill-name>/SKILL.md` 和项目级 `.echo/skills/<skill-name>/SKILL.md` 发现 skill。每个有效 skill SHALL 至少提供名称和描述，供系统生成可注入 provider 的短 catalog。发现优先级 SHALL 为 project 高于 user、user 高于 builtin；同名高优先级 skill SHALL 完整覆盖低优先级 skill 的元数据、正文和资源。

#### Scenario: 发现 built-in skill
- **WHEN** 当前安装包包含有效的 built-in `agent-memory/SKILL.md`
- **THEN** 系统 SHALL 把 `agent-memory` 识别为可用 skill
- **THEN** catalog SHALL 包含该 skill 的名称和描述

#### Scenario: 发现项目级 skill
- **WHEN** 当前工作区存在 `.echo/skills/code-review/SKILL.md`
- **THEN** 系统 SHALL 把 `code-review` 识别为可用 skill
- **THEN** catalog SHALL 包含该 skill 的名称和描述

#### Scenario: 发现用户级 skill
- **WHEN** 用户目录存在 `~/.echo/skills/unit-test/SKILL.md`
- **THEN** 系统 SHALL 把 `unit-test` 识别为可用 skill
- **THEN** 该 skill SHALL 可被 `use_skill` 工具按名称加载

#### Scenario: 高优先级 skill 覆盖同名低优先级 skill
- **WHEN** built-in、用户级或项目级目录存在同名 skill
- **THEN** 系统 SHALL 使用优先级最高来源的元数据、内容和资源
- **THEN** catalog SHALL 只包含该名称的一条 skill 记录

#### Scenario: 解析 SKILL.md frontmatter
- **WHEN** `SKILL.md` 以包含 `name` 和 `description` 的 frontmatter 开头
- **THEN** 系统 SHALL 使用 frontmatter 中的字段作为 skill 元数据
- **THEN** 系统 SHALL 把 frontmatter 后的 markdown 正文作为可加载的 skill 内容

#### Scenario: 无效 skill 不阻断主流程
- **WHEN** 某个 `SKILL.md` 缺少必要元数据或内容无法读取
- **THEN** 系统 SHALL 不因该文件阻止 TUI 启动或普通 agent 请求
- **THEN** 对该 skill 的显式加载 SHALL 返回明确失败信息

### Requirement: skill 启用状态持久化
系统 SHALL 支持持久化 discovered skill 的启用状态。每个 discovered skill 默认 enabled；被禁用的 skill SHALL 记录在其当前生效来源对应的 JSON 状态文件中。Project 和 user 来源 SHALL 继续写入各自 skill root；builtin 来源 SHALL 把状态写入用户级 `~/.echo/skills/skills.json`，不得修改 npm 安装目录。

#### Scenario: 默认 skill 为 enabled
- **WHEN** built-in、项目级或用户级 skill root 中存在有效 `SKILL.md` 且没有对应状态
- **THEN** 系统 SHALL 将该 skill 视为 enabled
- **THEN** 该 skill SHALL 可进入 enabled catalog、slash suggestion 和 `use_skill` 加载路径

#### Scenario: 从项目级状态文件读取 disabled skill
- **WHEN** `.echo/skills/skills.json` 包含有效 disabled 状态
- **THEN** 对应项目级 skill SHALL 被视为 disabled
- **THEN** 其他未列入 disabled 的项目级 skill SHALL 仍被视为 enabled

#### Scenario: 从用户级状态文件读取 disabled user skill
- **WHEN** `~/.echo/skills/skills.json` 将某个当前生效的用户级 skill 标记为 disabled
- **THEN** 该用户级 skill SHALL 被视为 disabled
- **THEN** 其他未列入 disabled 的用户级 skill SHALL 仍被视为 enabled

#### Scenario: 用户级状态控制当前生效的 builtin skill
- **WHEN** `agent-memory` 的当前生效来源为 builtin，且用户级 skill 状态将其标记为 disabled
- **THEN** `agent-memory` SHALL 不进入 enabled catalog 或 `use_skill` 加载路径
- **THEN** `/skills` 重新启用时 SHALL 更新用户级状态文件而不是包内目录

#### Scenario: 状态跟当前生效 skill source 绑定
- **WHEN** 高优先级 skill 覆盖同名低优先级 skill
- **THEN** 系统 SHALL 使用当前生效来源对应的状态决定该 skill 是否 enabled
- **THEN** `/skills` 保存时 SHALL 写入该来源规定的状态位置

#### Scenario: 状态文件损坏时安全降级
- **WHEN** skill 状态文件不可读、不是合法 JSON 或 disabled 字段无效
- **THEN** 系统 SHALL NOT 阻止 TUI 启动或普通 agent 请求
- **THEN** 系统 SHALL 对对应来源的 discovered skills 使用默认 enabled 状态
