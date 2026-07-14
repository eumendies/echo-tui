## ADDED Requirements

### Requirement: CommandHost 暴露 memory 管理能力
系统 SHALL 通过 `CommandHost` 向 `/memory` command handler 暴露受控的 memory 列表读取、新增、更新和删除能力。handler SHALL 仅通过该 facade 访问 memory 存储，且 SHALL NOT 直接访问完整 `AppContext`、文件系统、renderer、terminal 或 agent 实例。

#### Scenario: memory handler 通过 host 读取和保存
- **WHEN** `/memory` command handler 需要展示、创建、编辑或删除用户 memory
- **THEN** handler SHALL 调用 `CommandHost` 的 memory 领域能力
- **THEN** host SHALL 负责调用 memory 存储并返回结构化成功或失败结果

#### Scenario: 默认命令集合注册 memory command
- **WHEN** 系统创建默认 slash command handlers
- **THEN** handlers SHALL 包含 `/memory` command
- **THEN** slash command descriptors SHALL 包含 `/memory` 的说明

#### Scenario: command runtime 不解释 memory 业务 effect
- **WHEN** `/memory` command 浏览、编辑、保存、删除或取消
- **THEN** command handler SHALL 直接调用 `CommandHost` 或更新 command session
- **THEN** `CommandRuntime` SHALL NOT 为 memory 流程新增业务 effect interpreter 分支
