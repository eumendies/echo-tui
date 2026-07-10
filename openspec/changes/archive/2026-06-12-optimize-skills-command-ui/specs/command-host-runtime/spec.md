## MODIFIED Requirements

### Requirement: CommandHost 暴露 skill 管理能力
系统 SHALL 通过 `CommandHost` 向 skill 相关 slash command handler 暴露受控 skill 能力。handler SHALL 通过该能力列出 skill、加载 enabled skill、保存 enabled/disabled 状态并创建 slash skill user message；handler SHALL NOT 直接访问完整 AppContext、renderer 或 agent 实例。

#### Scenario: handler 通过 host 读取 skill 列表
- **WHEN** `/skills` command handler 需要展示 skill
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 skill 领域能力获取列表
- **THEN** handler SHALL NOT 直接扫描文件系统中的 skill root

#### Scenario: handler 通过 host 保存 skill 状态
- **WHEN** `/skills` command handler 确认保存 enabled/disabled 草稿状态
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 skill 领域能力保存状态
- **THEN** handler SHALL NOT 直接写入 renderer、terminal 或完整 app 内部状态

#### Scenario: direct skill handler 通过 host 创建注入消息
- **WHEN** direct skill invocation handler 命中 enabled skill
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 skill 领域能力加载 skill 并创建 user message 文本与 metadata
- **THEN** handler SHALL 返回 user message 提交结果给 command runtime
