## Purpose

定义 `/fork` 本地 slash command 的会话快照、分支切换、模型设置继承、失败反馈和共享工作目录边界。

## Requirements

### Requirement: `/fork` 从当前会话创建独立分支
系统 SHALL 提供无参数 `/fork` 本地 slash command，从当前非空 session 的最新稳定状态创建具有新 session id 的独立会话，并在创建成功后将当前 app 切换到新会话。该命令 SHALL NOT 作为 user message 提交给 provider，也 SHALL NOT 启动 agent request。

#### Scenario: 成功分叉当前会话
- **GIVEN** 当前 session 已持久化且包含 transcript records
- **WHEN** 用户提交 `/fork`
- **THEN** 系统 SHALL 创建不同于源 session id 的新 session
- **THEN** 当前 app SHALL 切换到新 session
- **THEN** 当前可见 transcript SHALL 保持不变
- **THEN** 系统 SHALL NOT 启动 provider request

#### Scenario: 命令匹配边界
- **WHEN** 用户提交 `/fork` 或仅带尾随空白的 `/fork `
- **THEN** 默认 slash command runtime SHALL 将其路由到 fork handler
- **WHEN** 用户提交带有非空参数的 `/fork something`
- **THEN** fork handler SHALL NOT 将其作为有效 `/fork` 命令消费

#### Scenario: 回答期间排队 fork
- **GIVEN** 当前 assistant turn 仍处于 response lock
- **WHEN** 用户将 `/fork` 作为待发送消息提交
- **THEN** 系统 SHALL NOT 在当前 turn 完成前分叉 session
- **THEN** 当前 turn 完成或失败后，系统 SHALL 按普通 slash 路由执行该命令

### Requirement: 分叉 session 保存自包含会话快照
系统 SHALL 在新 session 的独立 JSONL journal 中保存分叉时的全部当前 transcript records、compaction、todo state 和 change history。新 session SHALL 能在不读取源 journal 的情况下 replay 出与分叉时等价的会话状态。

#### Scenario: 复制完整会话状态
- **GIVEN** 当前 session 包含 transcript records、有效 compaction、todo state 和 change history
- **WHEN** `/fork` 成功
- **THEN** 新 session replay 后的 records SHALL 与分叉时当前 records 等价
- **THEN** 新 session 的 compaction、todo state 和 change history SHALL 与分叉时当前状态等价
- **THEN** 新 session SHALL 使用自身 journal 作为后续持久化目标

#### Scenario: 新旧分支独立追加
- **GIVEN** session A 已成功分叉为当前 session B
- **WHEN** 用户在 B 中继续提交消息并产生新的 transcript records
- **THEN** 新 records SHALL 只追加到 B 的 journal
- **THEN** 通过 `/resume` 恢复 A 时 SHALL NOT 出现 B 分叉后新增的 records

#### Scenario: 源会话后续变化不影响分叉
- **GIVEN** session A 已成功分叉出 session B
- **WHEN** 用户以后恢复 A 并追加或截断 A 的 records
- **THEN** B replay 后的分叉基线和既有后续 records SHALL 保持不变
- **THEN** B 的恢复 SHALL NOT 依赖读取 A 的 journal

### Requirement: 分叉继承当前 model 与 effort
系统 SHALL 将分叉时当前 session 生效的 model profile id 和可选 reasoning effort override 绑定到新 session，并尽力保存同新 session id 对应的 settings sidecar。源 session 的 settings SHALL 保持不变。

#### Scenario: 继承当前模型设置
- **GIVEN** 当前 session 选择了有效 model profile 和显式 effort override
- **WHEN** `/fork` 成功
- **THEN** 新 session 当前内存状态 SHALL 使用相同 model profile 和 effort override
- **THEN** 系统 SHALL 尽力为新 session id 写入对应 settings sidecar
- **THEN** 源 session 的 settings sidecar SHALL NOT 被改写

#### Scenario: 新 sidecar 写入失败
- **GIVEN** 新 session journal 已成功创建并切换
- **WHEN** 新 session settings sidecar 写入失败
- **THEN** `/fork` SHALL 保持成功且当前 app SHALL 继续使用分叉前的内存 model/effort
- **THEN** 系统 SHALL 保留后续正常提交时再次同步 settings 的机会
- **THEN** 系统 SHALL NOT 回滚或删除已经创建的新 journal

### Requirement: 分叉失败保持源 session
系统 SHALL 对空会话和持久化失败返回可理解结果。新 journal 创建成功之前，系统 SHALL NOT 切换当前 session reference；创建失败 SHALL 保持源 session、可见 transcript 和会话状态可继续使用。

#### Scenario: 空会话不可分叉
- **GIVEN** 当前会话没有 transcript records 或尚无持久化 session id
- **WHEN** 用户提交 `/fork`
- **THEN** 系统 SHALL 显示当前会话无法分叉的提示
- **THEN** 系统 SHALL NOT 创建空 journal 或 settings sidecar
- **THEN** 当前会话状态 SHALL 保持不变

#### Scenario: 新 journal 创建失败
- **GIVEN** 当前 session 可分叉
- **WHEN** 系统无法创建新 session journal
- **THEN** 系统 SHALL 显示脱敏、可理解的失败提示
- **THEN** 当前 session id SHALL 继续指向源 session
- **THEN** 当前 records、compaction、todo state、change history 和 model/effort SHALL 保持可用

### Requirement: `/fork` 使用瞬时反馈且不分叉文件系统
系统 SHALL 使用现有 command surface 展示 `/fork` 成功或失败反馈，且 SHALL NOT 因该命令追加 user、assistant、tool、local_notice 或 error transcript record。成功反馈 SHALL 说明后续对话写入新 session，并 SHALL 明确工作目录、Git 状态和文件系统未被复制。

#### Scenario: 成功反馈不污染 transcript
- **WHEN** `/fork` 成功创建并切换新 session
- **THEN** 系统 SHALL 展示包含新 session id 的瞬时成功反馈
- **THEN** 反馈 SHALL 说明源 session 仍可恢复且文件系统没有被分叉
- **THEN** 新 session records SHALL 与执行命令前的当前 records 等价

#### Scenario: 分叉后清理旧 context usage
- **GIVEN** 当前 app 持有最近一次 provider context usage
- **WHEN** `/fork` 成功切换到新 session
- **THEN** 系统 SHALL 清空该 transient context usage
- **THEN** 在新 session 完成下一次真实 provider request 前，status line 和 `/context` SHALL NOT 展示源 session 的旧 usage

#### Scenario: 默认命令集合暴露 fork
- **WHEN** 系统创建默认 slash command handlers 和 descriptors
- **THEN** handlers SHALL 包含 `/fork`
- **THEN** slash suggestion 与帮助文案 SHALL 提供 `/fork` 的会话分叉说明
