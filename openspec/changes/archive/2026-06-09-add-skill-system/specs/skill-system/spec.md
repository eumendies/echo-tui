## ADDED Requirements

### Requirement: skill 文件发现和元数据解析
系统 SHALL 从项目级 `.echo/skills/<skill-name>/SKILL.md` 和用户级 `~/.echo/skills/<skill-name>/SKILL.md` 发现 skill。每个有效 skill SHALL 至少提供名称和描述，供系统生成可注入 provider 的短 catalog。

#### Scenario: 发现项目级 skill
- **WHEN** 当前工作区存在 `.echo/skills/code-review/SKILL.md`
- **THEN** 系统 SHALL 把 `code-review` 识别为可用 skill
- **THEN** catalog SHALL 包含该 skill 的名称和描述

#### Scenario: 发现用户级 skill
- **WHEN** 用户目录存在 `~/.echo/skills/unit-test/SKILL.md`
- **THEN** 系统 SHALL 把 `unit-test` 识别为可用 skill
- **THEN** 该 skill SHALL 可被 `use_skill` 工具按名称加载

#### Scenario: 项目级 skill 覆盖同名用户级 skill
- **WHEN** 项目级目录和用户级目录同时存在同名 skill
- **THEN** 系统 SHALL 使用项目级 skill 的元数据和内容
- **THEN** catalog SHALL 只包含该名称的一条 skill 记录

#### Scenario: 解析 SKILL.md frontmatter
- **WHEN** `SKILL.md` 以包含 `name` 和 `description` 的 frontmatter 开头
- **THEN** 系统 SHALL 使用 frontmatter 中的字段作为 skill 元数据
- **THEN** 系统 SHALL 把 frontmatter 后的 markdown 正文作为可加载的 skill 内容

#### Scenario: 无效 skill 不阻断主流程
- **WHEN** 某个 `SKILL.md` 缺少必要元数据或内容无法读取
- **THEN** 系统 SHALL 不因该文件阻止 TUI 启动或普通 agent 请求
- **THEN** 对该 skill 的显式加载 SHALL 返回明确失败信息

### Requirement: skill catalog 常驻注入
系统 SHALL 在 provider system prompt 中注入短 skill catalog，使模型知道当前可用 skill 及其适用场景。catalog SHALL 只包含 skill 名称和描述，不得包含完整 `SKILL.md` 正文。

#### Scenario: 存在 skill 时注入短 catalog
- **WHEN** 发起 provider 请求且 registry 中存在可用 skill
- **THEN** system prompt SHALL 包含可用 skill 的名称和描述
- **THEN** system prompt SHALL 指示模型在任务匹配时调用 `use_skill`

#### Scenario: 无 skill 时不注入空 catalog
- **WHEN** 发起 provider 请求且 registry 中没有可用 skill
- **THEN** system prompt SHALL 不包含空的 skill catalog 区块

#### Scenario: catalog 不包含完整正文
- **WHEN** skill 的 `SKILL.md` 正文包含长工作流说明
- **THEN** system prompt 中的 catalog SHALL NOT 包含该长正文
- **THEN** 该正文 SHALL 只能通过 `use_skill` 工具加载

### Requirement: skill 内容按需加载
系统 SHALL 通过 `use_skill` 工具按名称加载完整 skill 内容。加载结果 SHALL 包含 skill 名称、来源、可选参数和正文，并 SHALL 作为普通 tool result 进入 transcript。

#### Scenario: 加载存在的 skill
- **WHEN** `use_skill` 收到 `{ "name": "code-review" }`
- **THEN** 系统 SHALL 读取匹配的 `SKILL.md`
- **THEN** tool result SHALL 标记成功并包含 skill 正文

#### Scenario: 加载时携带参数
- **WHEN** `use_skill` 收到 `{ "name": "code-review", "arguments": "src/foo.ts" }`
- **THEN** tool result SHALL 包含该 arguments 文本
- **THEN** tool result SHALL 保留完整 skill 正文供模型继续执行

#### Scenario: 加载不存在的 skill
- **WHEN** `use_skill` 收到未知 skill 名称
- **THEN** tool result SHALL 标记失败
- **THEN** result 文本 SHALL 包含可用 skill 名称或提示用户查看 catalog

### Requirement: skill 使用记录
系统 SHALL 能从 transcript 中识别 skill 使用记录。第一版 skill 使用记录 SHALL 来自模型调用 `use_skill` 后产生的 tool_call/tool_result 记录。

#### Scenario: 模型自动调用产生使用记录
- **WHEN** 模型调用 `use_skill` 并得到 tool result
- **THEN** agent loop SHALL 追加对应 `tool_call` record
- **THEN** agent loop SHALL 追加对应 `tool_result` record
- **THEN** 系统 SHALL 能从 transcript 中识别该次 skill 使用

#### Scenario: 非 use_skill 工具调用不计为 skill 使用
- **WHEN** transcript 包含其他工具的 tool_call/tool_result 记录
- **THEN** 系统 SHALL NOT 把这些记录识别为 skill 使用记录

### Requirement: 第一版不提供 slash skill command
系统 SHALL NOT 在本 change 中新增 `/skill` slash command。未来若引入 slash 方式加载 skill，该 slash 调用产生的 skill 内容 SHALL 以 user message 形式进入上下文，而不是伪造为模型发起的 `use_skill` tool_call/tool_result。

#### Scenario: 默认 slash command 不包含 /skill
- **WHEN** 系统创建默认 slash command handlers 或 suggestion descriptors
- **THEN** 默认命令集合 SHALL NOT 包含 `/skill`

#### Scenario: slash skill 调用不伪造工具调用
- **WHEN** 后续 change 设计 slash skill 调用
- **THEN** 该设计 SHALL NOT 要求把用户 slash 调用表达为模型 `use_skill` tool_call
- **THEN** 加载出的 skill 内容 SHALL 以 user message 语义注入后续上下文
