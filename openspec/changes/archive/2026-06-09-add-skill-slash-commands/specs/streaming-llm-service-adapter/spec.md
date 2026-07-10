## ADDED Requirements

### Requirement: provider skill catalog 只包含 enabled skills
真实 LLM adapter 注入 provider system prompt 的 skill catalog SHALL 只包含当前 enabled skills。disabled skills SHALL 不出现在 provider catalog 中，也 SHALL 不被描述为模型可通过 `use_skill` 调用的候选项。

#### Scenario: disabled skill 不进入 catalog
- **WHEN** skill registry 发现某个有效 skill 但该 skill 被状态文件标记为 disabled
- **THEN** provider system prompt 的 skill catalog SHALL NOT 包含该 skill 的名称或描述
- **THEN** catalog SHALL 继续包含其他 enabled skills

#### Scenario: 状态变化后新请求使用最新 catalog
- **WHEN** 用户通过 `/skills manage` 保存 skill 启用状态变化
- **THEN** 后续新的 agent run SHALL 基于最新 enabled skills 生成 provider skill catalog
- **THEN** 系统 SHALL NOT 要求重启 TUI 才更新 provider catalog

### Requirement: slash 注入 skill 内容参与普通 provider input
通过 direct slash skill invocation 产生的 user record SHALL 按普通 user transcript record 参与 provider input 转换。该 user record SHALL 能在无压缩时进入完整上下文，在有压缩时按既有活跃区间与摘要规则处理。

#### Scenario: slash skill user record 进入 provider input
- **WHEN** 用户通过 direct slash skill invocation 追加了 user transcript record 并触发 agent
- **THEN** OpenAI transcript converter SHALL 将该 record 作为 user message 转换
- **THEN** provider input SHALL 包含该 record 中的 skill 内容和 arguments

#### Scenario: slash skill user record 按普通压缩规则处理
- **WHEN** 存在压缩状态且 slash skill user record 位于活跃区间内
- **THEN** provider input SHALL 包含该 user record
- **WHEN** 该 user record 位于压缩边界之前
- **THEN** provider input SHALL 不再包含其原文，并 SHALL 由压缩摘要承载必要信息
