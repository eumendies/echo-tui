## ADDED Requirements

### Requirement: provider system prompt 注入 skill catalog
真实 LLM adapter 的 provider records 构建 SHALL 在内置 system prompt 中包含当前可用 skill catalog。catalog SHALL 基于默认 skill registry 发现结果生成，并 SHALL 只包含模型选择 skill 所需的短元数据。

#### Scenario: 构造 provider records 时包含 skill catalog
- **WHEN** agent loop runtime 构造 provider records 且存在可用 skill
- **THEN** 第一条 system record SHALL 包含内置系统提示和 skill catalog
- **THEN** catalog SHALL 包含每个 skill 的名称和描述

#### Scenario: catalog 引导模型调用 use_skill
- **WHEN** system prompt 包含 skill catalog
- **THEN** catalog 文本 SHALL 说明模型可在用户请求明确匹配某个 skill 时调用 `use_skill`
- **THEN** catalog 文本 SHALL NOT 要求模型无条件加载全部 skill

#### Scenario: skill catalog 随 registry 更新
- **WHEN** 发起新的 agent run 且 skill 文件内容或集合已变化
- **THEN** 系统 SHALL 基于当前文件系统重新生成或刷新 skill catalog
- **THEN** 后续 provider 请求 SHALL 使用最新可用的 skill 名称和描述

#### Scenario: 无 skill 时保持原请求形态
- **WHEN** 当前没有可用 skill
- **THEN** provider system prompt SHALL 保持不包含 skill catalog
- **THEN** 普通 OpenAI input 转换和工具 schema 发送语义 SHALL 保持不变
