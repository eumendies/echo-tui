## MODIFIED Requirements

### Requirement: provider skill catalog 只包含 enabled skills
真实 LLM adapter 注入 provider system prompt 的 skill catalog SHALL 只包含当前 enabled skills。disabled skills SHALL 不出现在 provider catalog 中，也 SHALL 不被描述为模型可通过 `use_skill` 调用的候选项。

#### Scenario: disabled skill 不进入 catalog
- **WHEN** skill registry 发现某个有效 skill 但该 skill 被状态文件标记为 disabled
- **THEN** provider system prompt 的 skill catalog SHALL NOT 包含该 skill 的名称或描述
- **THEN** catalog SHALL 继续包含其他 enabled skills

#### Scenario: 状态变化后新请求使用最新 catalog
- **WHEN** 用户通过 `/skills` 保存 skill 启用状态变化
- **THEN** 后续新的 agent run SHALL 基于最新 enabled skills 生成 provider skill catalog
- **THEN** 系统 SHALL NOT 要求重启 TUI 才更新 provider catalog
