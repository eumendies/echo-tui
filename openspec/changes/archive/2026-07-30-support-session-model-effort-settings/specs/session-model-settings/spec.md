## ADDED Requirements

### Requirement: 新 session 从全局 model/effort 默认初始化
系统 SHALL 为每个新交互式 session 创建独立的 model/effort 内存状态。初始 model SHALL 来自用户级 `llm.selectedModel` 的有效 profile，缺失或失效时 SHALL 使用既有首个有效 profile 回退；初始 effort SHALL 使用该 profile 的默认 reasoning effort，且 SHALL NOT 创建显式 session effort override。

#### Scenario: 两个新 session 独立初始化
- **WHEN** 两个交互式 app session 在同一用户配置下分别启动
- **THEN** 两者 SHALL 分别从当时的全局默认 model/effort 初始化独立内存状态
- **THEN** 任一 session 后续修改 model 或 effort SHALL NOT 改变另一个 session 的状态

#### Scenario: 全局 selectedModel 失效
- **WHEN** 新 session 初始化时 `llm.selectedModel` 缺失或引用不存在的 profile
- **THEN** 系统 SHALL 使用既有首个有效 model profile 回退
- **THEN** 新 session SHALL 能使用该有效 profile 发起后续请求

### Requirement: Session settings sidecar 只保存当前 model/effort
系统 MAY 为已持久化 session 使用与 journal 同目录、以同一 session id 命名的独立 settings JSON sidecar 保存当前 `modelProfileId`、可选 `reasoningEffortOverride`、schema version、session id 和更新时间。每次成功保存 SHALL 使用临时文件加 rename 原子覆盖当前值，SHALL NOT 在 transcript journal、transcript record 或 sidecar 中追加 model/effort 切换历史。

#### Scenario: 首次提交创建 settings 与 journal
- **WHEN** 尚未持久化的新 session 提交第一条 user record
- **THEN** 系统 SHALL 正常创建既有 JSONL journal 并取得其 session id
- **THEN** 系统 SHALL 使用该 id 尽力原子保存当前 settings
- **THEN** settings SHALL NOT 成为 transcript journal operation 或 provider context

#### Scenario: 已持久化 session 更新当前值
- **WHEN** 已持久化 session 成功选择新的 model 或 effort
- **THEN** 系统 SHALL 原子覆盖该 session 的 settings sidecar
- **THEN** sidecar SHALL 只包含保存后的当前值而非此前选择历史
- **THEN** 对应 JSONL journal SHALL 保持不变

#### Scenario: settings 写入失败不影响交互
- **WHEN** 首次或后续提交时无法保存 session settings
- **THEN** 系统 SHALL 保留当前内存 model/effort 并正常创建或追加 journal
- **THEN** 系统 SHALL 正常启动 provider turn
- **THEN** status line SHALL 继续显示当前实际请求会使用的 model/effort，且 SHALL NOT 显示 sidecar 存储错误

#### Scenario: 孤立 settings 不参与恢复
- **WHEN** session 目录存在 settings sidecar但不存在同 id 的有效 JSONL journal
- **THEN** `/resume` 和会话引用候选 SHALL NOT 列出该 sidecar
- **THEN** 系统 SHALL NOT 将其视为可恢复 session

### Requirement: Model 与 effort 命令只更新当前 session
系统 SHALL 让 `/model` 更新当前 session 的 model profile，让 `/effort` 更新当前 session 的显式 reasoning effort override，并 SHALL NOT 因这些命令修改 `llm.selectedModel` 或任一 model profile 的 `reasoning.effort`。

#### Scenario: /model 不影响其他 session
- **WHEN** session A 通过 `/model` 选择新的有效 profile
- **THEN** session A 后续普通 turn 和 status line SHALL 使用新 profile
- **THEN** session B 和用户级 `llm.selectedModel` SHALL 保持不变
- **THEN** session A 旧的 effort override SHALL 被清除并使用新 profile 默认 effort

#### Scenario: /effort 不改写 profile
- **WHEN** session A 通过 `/effort` 选择包括 `none` 在内的有效 effort
- **THEN** session A SHALL 保存并使用该显式 effort override
- **THEN** session B 和用户级 model profile 的 `reasoning.effort` SHALL 保持不变

#### Scenario: 持久化写入失败仍更新当前值
- **WHEN** 已持久化 session 保存新的 model 或 effort sidecar 失败
- **THEN** 系统 SHALL 使用新选择更新 session model/effort 内存缓存
- **THEN** UI SHALL 显示新选择且后续当前进程内 turn SHALL 使用它

### Requirement: Session settings 随 clear 与 resume 切换
系统 SHALL 在 `/resume` 成功加载 session 时恢复其有效 model/effort settings，并 SHALL 在 `/clear` 后丢弃当前绑定、从最新全局默认初始化新的未持久化 session。

#### Scenario: 恢复具有 settings 的 session
- **WHEN** 用户恢复一个 journal 与有效 settings sidecar 都存在的 session
- **THEN** 当前 ModelContext、status line 和后续普通 provider turn SHALL 使用 sidecar 中的 model/effort
- **THEN** 恢复前 session 的 model/effort SHALL NOT 泄漏到恢复后的 session

#### Scenario: 清空后采用最新全局默认
- **WHEN** 用户在已选择 session model/effort 后执行 `/clear`
- **THEN** 系统 SHALL 解绑原 session 的 journal 与 settings
- **THEN** 新的内存 session SHALL 从执行 clear 时的最新全局默认初始化
- **THEN** 原 session sidecar SHALL 保持不变以供以后恢复

#### Scenario: 兼容没有 sidecar 的旧 session
- **WHEN** 用户恢复有效 journal但对应 settings sidecar 缺失、损坏、schema 不支持或 session id 不匹配
- **THEN** 系统 SHALL 保留 transcript 恢复结果并从当前全局默认初始化 model/effort
- **THEN** 系统 MAY 在后续正常提交时尽力写入规范 sidecar，且失败 SHALL NOT 影响请求

#### Scenario: Session profile 已被删除
- **WHEN** settings sidecar 的 modelProfileId 不再对应有效 profile
- **THEN** 系统 SHALL 回退当前有效全局默认 model并清除 sidecar 中不再适用的 effort override
- **THEN** 系统 SHALL 清空旧 context usage；status line SHALL 显示回退后的有效 model/effort

### Requirement: 普通 turn 使用 session settings 且 skill override 优先
系统 SHALL 将当前 session 的 model profile id 和可选 effort override传入每次普通 agent run。显式 skill invocation 提供的 model 或 effort override SHALL 只覆盖其明确提供的字段；未提供的字段 SHALL 保留 session 值，合并结果 SHALL 在该 agent loop 及其 tool continuation 中保持不变。

#### Scenario: 普通 turn 使用 session model/effort
- **WHEN** 当前 session 已选择 model profile 和显式 effort override并提交普通用户请求
- **THEN** agent runtime SHALL 使用该 profile 对应的 provider、model、context window和 session effort override
- **THEN** 运行时 SHALL NOT 依赖 `llm.selectedModel` 决定本轮 profile

#### Scenario: Skill 只覆盖 model
- **WHEN** 显式 skill invocation 配置 model override但未配置 effort override
- **THEN** 本轮 SHALL 使用 skill model profile
- **THEN** 本轮 effort SHALL 使用当前 session effort override；若 session 也未配置 override则使用 skill model profile 默认 effort

#### Scenario: Skill 只覆盖 effort
- **WHEN** 显式 skill invocation 未配置 model override但配置了 effort override
- **THEN** 本轮 SHALL 使用当前 session model profile
- **THEN** 本轮 SHALL 使用 skill effort override

#### Scenario: Skill 未配置 override
- **WHEN** 显式 skill invocation 的 model 和 effort override 都未配置
- **THEN** `undefined` 字段 SHALL NOT 覆盖当前 session model/effort
- **THEN** 本轮 SHALL 使用完整的 session settings

### Requirement: Headless 运行保持全局配置边界
Session model/effort settings SHALL 只适用于交互式持久化 session，SHALL NOT 为 `--once` 创建或读取 session sidecar。

#### Scenario: once 不创建 settings
- **WHEN** 用户通过 `--once` 执行 headless 请求
- **THEN** 系统 SHALL 继续使用用户级全局默认和既有显式 per-run override规则
- **THEN** 系统 SHALL NOT 创建、读取或等待 session settings sidecar
