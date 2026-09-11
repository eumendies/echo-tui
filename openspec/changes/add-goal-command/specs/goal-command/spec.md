## ADDED Requirements

### Requirement: `/goal` 命令语法与生命周期操作
系统 SHALL 提供 `/goal` slash command 管理当前 session 的常驻目标（standing goal）。`/goal <condition>` SHALL 设置或替换目标，条件去除首尾空白后非空且不超过 4000 字符；裸 `/goal` SHALL 展示当前目标状态卡；`/goal pause`、`/goal resume`、`/goal clear`（`stop`、`off`、`reset`、`cancel` 为 clear 别名）SHALL 分别暂停、恢复和清除目标。子命令 SHALL 仅在参数恰为单个子命令词时生效，其余参数 SHALL 按目标条件处理。命令执行 SHALL 保持本地命令语义，不得作为 user message 提交给 agent。目标 SHALL 可在任意 interaction mode 下管理；推进回合 SHALL 遵循发起时的 interaction mode 与既有工具策略。

#### Scenario: 设置目标并立即开始推进
- **WHEN** 用户提交 `/goal <condition>` 且当前没有 goal、没有进行中的 assistant turn、没有 pending 消息且没有 active command session
- **THEN** 系统 SHALL 创建 status 为 `active` 的 goal 状态
- **AND** 系统 SHALL 立即发起第一个自动推进回合
- **AND** transcript SHALL 追加目标已设置的 local notice

#### Scenario: 忙碌时设置目标等待推进
- **WHEN** 用户提交 `/goal <condition>` 且当前存在进行中的 assistant turn、pending 消息或 active command session
- **THEN** 系统 SHALL 创建 status 为 `active` 的 goal 状态
- **AND** 系统 SHALL NOT 打断或抢占当前流程
- **AND** 目标推进 SHALL 在后续回合完成通知到来时按自动续跑语义开始

#### Scenario: 替换已有目标
- **WHEN** 当前存在 goal（active 或 paused）且用户提交新的 `/goal <condition>`
- **THEN** 系统 SHALL 用新条件替换旧目标并递增 revision
- **AND** 旧目标的轮次计数与最近评估 SHALL NOT 保留到新目标

#### Scenario: 展示状态卡
- **WHEN** 用户提交裸 `/goal` 且当前存在 goal
- **THEN** 系统 SHALL 打开只读状态卡 surface
- **AND** 状态卡 SHALL 展示条件、状态、已发起推进回合数与上限（N/M）、本次激活耗时、最近评估结果与理由
- **AND** 状态卡 SHALL 提示 pause、resume 和 clear 的可用形式

#### Scenario: 无目标时的裸命令
- **WHEN** 用户提交裸 `/goal` 且当前不存在 goal
- **THEN** 系统 SHALL 展示「当前没有目标」及用法提示
- **AND** 系统 SHALL NOT 创建 goal 状态

#### Scenario: 暂停目标
- **WHEN** 当前 goal 状态为 `active` 且用户提交 `/goal pause`
- **THEN** 系统 SHALL 将状态置为 `paused` 并停止发起后续推进回合

#### Scenario: 恢复目标
- **WHEN** 当前 goal 状态为 `paused`、存在有效评估模型配置且用户提交 `/goal resume`
- **THEN** 系统 SHALL 将状态置回 `active` 并递增 revision
- **AND** 当前空闲时 SHALL 立即恢复推进流程

#### Scenario: 清除目标
- **WHEN** 用户提交 `/goal clear`（含别名）且当前存在 goal
- **THEN** 系统 SHALL 移除 goal 状态并写入清除 local notice
- **AND** 系统 SHALL NOT 因清除中断正在运行的 assistant turn
- **AND** 迟到评估结果 SHALL 按隔离语义被丢弃

#### Scenario: 非法或超长条件
- **WHEN** 用户提交空条件或超过 4000 字符的条件
- **THEN** 系统 SHALL 拒绝该输入并展示用法提示
- **AND** 现有 goal 状态 SHALL 保持不变

### Requirement: goal 需要有效的评估模型配置
系统 SHALL 在设置或恢复目标时要求当前配置中存在有效的 goal 评估模型 profile（`goal.evaluationModelProfileId` 并存在于 `llm.models`）。缺失或失效时 `/goal <condition>` 与 `/goal resume` SHALL 拒绝操作并指引用户到 `/config` 配置评估模型；裸 `/goal`、`/goal pause` 与 `/goal clear` SHALL 不受该限制影响。

#### Scenario: 未配置评估模型时拒绝设置
- **WHEN** 当前配置不存在有效的 goal 评估模型 profile
- **AND** 用户提交 `/goal <condition>`
- **THEN** 系统 SHALL NOT 创建 goal 状态
- **AND** 系统 SHALL 提示需要先在 `/config` 配置 goal 评估模型

#### Scenario: 未配置时仍可查看与清理
- **WHEN** 当前配置不存在有效的 goal 评估模型 profile
- **AND** 用户提交裸 `/goal` 或 `/goal clear`
- **THEN** 系统 SHALL 按正常语义展示状态卡或清除目标

### Requirement: GoalState 会话状态与 journal 持久化
系统 SHALL 为每个 transcript session 维护结构化 GoalState，包含：完成条件、状态（`active`/`paused`）、revision、本次激活时间、已发起推进回合数、回合上限（默认 20）与最近评估结果。GoalState SHALL 通过 session JSONL journal 中独立的 `set_goal_state` 操作保存与加载，不得作为普通 transcript record 保存，也不得参与 context compaction 边界计算。revision SHALL 在设置、替换或恢复目标时递增，用于隔离迟到回调与评估结果。

#### Scenario: 保存包含 goal 的 session
- **WHEN** 当前 session 存在 goal 且 app 持久化当前 goalState
- **THEN** session JSONL journal SHALL 追加独立的 `set_goal_state` 操作
- **AND** 该操作 SHALL 包含当前 GoalState 完整字段或 `null` 表示无目标
- **AND** 该操作 SHALL NOT 因 goalState 更新而包含 compaction、todoState 或 change history 的副本

#### Scenario: 恢复 session 时目标是暂停态
- **WHEN** 用户通过 `/resume` 加载包含 `set_goal_state` 操作的 session journal
- **THEN** app SHALL 恢复该 session 的最后一个有效 goal 状态
- **AND** 状态 SHALL 置为 `paused`，轮次计数 SHALL 重置为 0，激活时间 SHALL 刷新为恢复时间
- **AND** 条件、回合上限与最近评估 SHALL 保留
- **AND** 系统 SHALL NOT 在用户显式 `/goal resume` 前自动发起推进回合

#### Scenario: journal 没有 goal 状态操作
- **WHEN** app 加载有效 session journal 且其中不存在 `set_goal_state` 操作
- **THEN** app SHALL 使用无目标状态
- **AND** 加载 SHALL NOT 失败

#### Scenario: 清空 transcript 同步清空 goalState
- **WHEN** 用户执行清空当前会话的操作
- **THEN** app SHALL 清空当前 transcript records
- **AND** app SHALL 清空当前 goalState

### Requirement: goal 生命周期本地通知
系统 SHALL 在目标设置、评估结果、完成、暂停与清除时写入 local notice，使目标生命周期可审计。评估判定达成时系统 SHALL 清除当前 goal 状态并写入完成通知；暂停通知 SHALL 包含暂停原因。

#### Scenario: 设置或替换通知
- **WHEN** 用户成功设置或替换目标
- **THEN** transcript SHALL 追加包含目标条件与回合上限的 local notice

#### Scenario: 评估未达成通知
- **WHEN** 一次评估判定未达成且系统将继续推进
- **THEN** transcript SHALL 追加包含轮次进度与评估理由的 local notice

#### Scenario: 达成完成通知
- **WHEN** 一次评估判定达成
- **THEN** 系统 SHALL 清除当前 goal 状态
- **AND** transcript SHALL 追加包含总轮次与评估理由的完成 local notice

#### Scenario: 暂停通知
- **WHEN** 目标因用户中断、回合失败、评估不可用或达到回合上限而暂停
- **THEN** transcript SHALL 追加说明暂停原因与 `/goal resume` 恢复方式的 local notice

### Requirement: footer goal 状态段
footer 状态行 SHALL 在 goal 存在时展示 goal 段：`active` 状态展示轮次进度（N/M），`paused` 状态展示暂停标记；不存在 goal 时 SHALL NOT 展示该段。评估请求进行期间该段 SHALL 展示评估中指示。

#### Scenario: active 目标徽标
- **WHEN** 当前 goal 状态为 `active`
- **THEN** footer 状态行 SHALL 展示 goal 段与 `N/M` 轮次进度

#### Scenario: paused 目标徽标
- **WHEN** 当前 goal 状态为 `paused`
- **THEN** footer 状态行 SHALL 展示暂停标记

#### Scenario: 无目标隐藏
- **WHEN** 当前不存在 goal
- **THEN** footer 状态行 SHALL NOT 展示 goal 段

#### Scenario: 评估中指示
- **WHEN** 一次目标评估请求正在进行
- **THEN** footer goal 段 SHALL 展示评估中状态
