## ADDED Requirements

### Requirement: slash command 可转换为 user message 继续提交
系统 SHALL 支持 slash command handler 在启动时返回“将当前输入转换为 user message 并继续普通提交”的结果。该结果 SHALL 由 command runtime 传回 app 提交流程，后续 agent turn SHALL 复用普通用户消息提交路径。

#### Scenario: handler 返回 user message 提交结果
- **WHEN** slash command handler 启动后返回转换后的 user message 文本
- **THEN** command runtime SHALL 将该结果返回给 app 提交流程
- **THEN** app SHALL 追加该 user message transcript record 并触发普通 agent 请求
- **THEN** command runtime SHALL NOT 自行执行 agent streaming 或 tool continuation

#### Scenario: 既有命令保持消费语义
- **WHEN** 既有 slash command handler 启动后不返回 user message 提交结果
- **THEN** command runtime SHALL 继续把该输入视为已由命令消费
- **THEN** app SHALL NOT 因该命令启动而触发普通 agent 请求

### Requirement: CommandHost 暴露 skill 管理能力
系统 SHALL 通过 `CommandHost` 向 skill 相关 slash command handler 暴露受控 skill 能力。handler SHALL 通过该能力列出 skill、加载 enabled skill、保存 manage 状态并创建 slash skill user message；handler SHALL NOT 直接访问完整 AppContext、renderer 或 agent 实例。

#### Scenario: handler 通过 host 读取 skill 列表
- **WHEN** `/skills list` 或 `/skills manage` command handler 需要展示 skill
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 skill 领域能力获取列表
- **THEN** handler SHALL NOT 直接扫描文件系统中的 skill root

#### Scenario: handler 通过 host 保存 manage 状态
- **WHEN** `/skills manage` command handler 确认保存 enabled/disabled 草稿状态
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 skill 领域能力保存状态
- **THEN** handler SHALL NOT 直接写入 renderer、terminal 或完整 app 内部状态

#### Scenario: direct skill handler 通过 host 创建注入消息
- **WHEN** direct skill invocation handler 命中 enabled skill
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 skill 领域能力加载 skill 并创建 user message 文本与 metadata
- **THEN** handler SHALL 返回 user message 提交结果给 command runtime
