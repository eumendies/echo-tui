## MODIFIED Requirements

### Requirement: use_skill 尊重 skill 启用状态
`use_skill` 工具 SHALL 只加载当前 enabled skill。对于 discovered 但 disabled 的 skill，handler SHALL 返回失败的 tool execution result，并 SHALL NOT 返回完整 skill 正文。

#### Scenario: use_skill 加载 disabled skill 失败
- **WHEN** `use_skill` 收到名称匹配 disabled skill 的参数
- **THEN** handler SHALL 返回 `ok: false` 的 tool result
- **THEN** result 文本 SHALL 明确说明该 skill 当前 disabled
- **THEN** result 文本 SHALL 提示可通过 `/skills` 启用
- **THEN** result 文本 SHALL NOT 包含该 skill 的完整正文

#### Scenario: use_skill 只列出 enabled 可用项
- **WHEN** `use_skill` 收到未知 skill 名称并返回可用 skill 列表
- **THEN** 该列表 SHALL 只包含 enabled skills
- **THEN** disabled skills SHALL NOT 作为可加载项提供给模型
