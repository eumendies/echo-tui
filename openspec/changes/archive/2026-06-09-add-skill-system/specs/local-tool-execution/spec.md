## ADDED Requirements

### Requirement: use_skill 本地工具
系统 SHALL 在默认本地 tool registry 中注册 `use_skill` 工具。该工具 SHALL 接收 JSON object 参数 `{ "name": string, "arguments"?: string | null }`，并 SHALL 返回指定 skill 的完整 markdown 内容作为普通 tool execution result。

#### Scenario: 默认注册 use_skill 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `use_skill` 的 tool definition
- **THEN** 该 definition SHALL 要求 `name` 字段为 string
- **THEN** 该 definition SHALL 允许 `arguments` 字段为 string 或 null

#### Scenario: 执行 use_skill 成功
- **WHEN** `use_skill` 收到已发现的 skill 名称
- **THEN** handler SHALL 读取该 skill 的 `SKILL.md`
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含 skill 名称、来源路径和正文内容

#### Scenario: 执行 use_skill 失败
- **WHEN** `use_skill` 收到空名称、非 string 名称、未知名称或无法读取的 skill
- **THEN** handler SHALL 返回 `ok: false` 的 tool result
- **THEN** result 文本 SHALL 包含简洁失败原因
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

#### Scenario: use_skill result 参与 agent continuation
- **WHEN** `use_skill` 执行完成并返回 tool result
- **THEN** agent loop runtime SHALL 追加对应 `tool_call` record 和 `tool_result` record
- **THEN** 后续 provider continuation SHALL 能接收该 skill 内容作为 function call output
