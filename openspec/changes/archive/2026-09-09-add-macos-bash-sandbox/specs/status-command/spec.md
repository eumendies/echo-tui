## MODIFIED Requirements

### Requirement: `/status` command 展示当前运行状态
系统 SHALL 提供精确匹配的 `/status` slash command,并 SHALL 在只读 command surface 中展示当前目录、生效的 AGENTS.md 来源、有效 memory 摘要、当前 model/provider、session id 和当前沙箱状态。沙箱状态 SHALL 包含生效档位、网络开关与沙箱实现标识;配置的档位未生效(如平台不支持或沙箱工具缺失导致降级)时 SHALL 展示不可用状态。该命令 SHALL NOT 展示 context token 占用。

#### Scenario: 展示当前运行状态
- **WHEN** 用户提交 `/status`
- **THEN** 系统 SHALL 打开 status command surface
- **AND** surface SHALL 展示当前工作目录
- **AND** surface SHALL 展示当前请求会采用的 AGENTS.md 文件来源
- **AND** surface SHALL 展示启用的用户 memory 数量和有效 agent memory catalog 摘要
- **AND** surface SHALL 展示当前 model 和 provider
- **AND** surface SHALL 展示当前 session id,尚未创建持久化 session 时 SHALL 显示稳定的未创建状态
- **AND** surface SHALL 展示当前沙箱档位、网络开关与实现标识,或沙箱不可用状态
- **AND** surface SHALL NOT 展示 context used tokens、context window 或 context 分类占用

#### Scenario: status command 保持本地只读语义
- **WHEN** 用户提交 `/status`
- **THEN** command runtime SHALL 将输入作为本地命令消费
- **AND** 系统 SHALL NOT 将 `/status` 作为 user message 提交给 agent
- **AND** 系统 SHALL NOT 追加 transcript record

#### Scenario: 拒绝额外参数
- **WHEN** 用户提交带额外参数的 `/status` 输入
- **THEN** 系统 SHALL NOT 将其匹配为 `/status` command
- **AND** slash command 解析 SHALL 保持与其他纯命令一致的精确匹配语义
