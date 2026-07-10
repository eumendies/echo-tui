## ADDED Requirements

### Requirement: 默认 fake 配置与 /config 兼容
系统 SHALL 允许 bootstrap 创建的默认 fake agent 配置被 `/config` 读取，并在用户保存 provider/model 配置时继续遵循现有配置持久化和敏感信息保护规则。

#### Scenario: /config 读取默认 fake 配置
- **WHEN** `~/.echo/config.json` 是 bootstrap 创建的默认 fake 配置
- **AND** 用户提交纯 `/config`
- **THEN** 系统 SHALL 打开配置面板且不报配置缺失错误
- **THEN** 配置面板 SHALL 能展示或安全跳过 fake provider，而不得破坏现有 provider/model 草稿状态

#### Scenario: 保存真实 provider 时替换默认配置
- **WHEN** 用户从默认 fake 配置进入 `/config`
- **AND** 用户配置并保存有效真实 provider 和 model
- **THEN** 系统 SHALL 写入用户选择的 `llm.providers`、`llm.models` 和 `llm.selectedModel`
- **THEN** 系统 SHALL 继续使用原子写入方式保存 `~/.echo/config.json`

#### Scenario: 默认 fake 配置不引入敏感字段
- **WHEN** `/config` 读取 bootstrap 创建的默认配置
- **THEN** 配置面板 SHALL NOT 展示任何由 bootstrap 写入的真实 API key、Bearer token、x-api-key 或隐藏 header 值

