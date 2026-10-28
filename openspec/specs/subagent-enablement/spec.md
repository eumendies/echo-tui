# subagent-enablement Specification

## Purpose
统一管理内置与自定义 Agent 的全局启停，使配置、管理界面、冻结目录和实际委派遵循一致的准入规则。

## Requirements
### Requirement: 内置与自定义 Agent 使用统一的版本化启停配置

用户级 `~/.echo/agents.settings.json` version 3 SHALL 支持必需的 `overrides` 对象及可选 `enabled` 对象。`enabled` SHALL 按稳定 Agent 名称映射到 boolean，支持内置与自定义名称；缺省 SHALL 等同于空对象，名称缺省 SHALL 启用。全局读取 SHALL 支持 version 1/2/3。系统 SHALL 拒绝非法名称、非 boolean 值、错误结构、未知字段及不支持的版本，且 SHALL NOT 对错误类型做隐式转换。

#### Scenario: 内置和自定义使用同一映射
- **WHEN** 合法用户级 version 3 settings 声明 `enabled.explorer=false` 和 `enabled.reviewer=false`
- **THEN** 系统 SHALL 对两个名称应用同一套停用解析规则，不要求修改任何 Agent Markdown 或模型 override

#### Scenario: 读取缺省全局状态
- **WHEN** 系统读取合法用户级 version 1/2 settings 或未包含 `enabled` 的用户级 version 3 settings
- **THEN** 全局开关 SHALL 默认开启，读取 SHALL 保持文件内容不变

#### Scenario: 拒绝非法启停声明
- **WHEN** 用户级 `enabled` 不是对象、值是字符串 `"false"` 或 `null`、键包含路径片段
- **THEN** 系统 SHALL 将该 settings 来源标记为结构无效，返回有界诊断且 SHALL NOT 部分应用该文件

### Requirement: 按名称应用全局启停

系统 SHALL 读取用户级 `enabled` 作为按名称的全局启停，缺省 true、所有项目共用。模型、effort、Skills 的既有来源优先级 SHALL 保持不变。定义先按原规则选择，再应用全局开关；全局停用某名称时，其项目胜出定义 SHALL NOT 回退同名用户定义。未知名称的全局启停偏好 SHALL 保留但不创建定义，删除定义 SHALL NOT 清理偏好。

#### Scenario: 全局关闭跨项目生效
- **WHEN** 全局 reviewer=false，用户在不同项目运行
- **THEN** 所有项目的 reviewer SHALL 停用，其他名称与模型策略 SHALL 不受影响

#### Scenario: 合法名称不读取原型属性
- **WHEN** 名称为 constructor 的合法 Agent 没有显式启停键
- **THEN** UI 草稿与运行目录 SHALL 使用相同选择规则并均得到布尔值 true，不把对象原型属性当作配置

#### Scenario: 全局选择应用于不同定义来源
- **WHEN** 全局 `worker=false` 且项目声明 Worker 模型 override，或全局 `reviewer=false` 且项目同名自定义定义胜出
- **THEN** 对应名称 SHALL 因全局选择而停用，模型策略与定义来源 SHALL NOT 绕过该结果
- **THEN** 全局停用的 reviewer SHALL NOT 回退同名用户定义

### Requirement: 全局启停使用单文件安全保存

启停 mutation SHALL 写用户级 sidecar，接受合法名称及布尔值或明确移除键以恢复默认开启。系统 SHALL 复用安全目录、普通文件校验、整文件内容指纹和同目录原子替换，拒绝符号链接和不安全目标；修改 SHALL 保留其他名称及模型 override，失败 SHALL 不覆盖原文件。成功写入 SHALL 使用 version 3，`enabled` 与 `overrides` 均空时可删除全局 sidecar。用户模型策略写删 SHALL 保留同文件全局偏好。文件变更 SHALL 由显式 mutation 触发。

#### Scenario: 只保存全局开关
- **WHEN** 用户保存 Explorer 停用
- **THEN** 系统 SHALL 只改全局 sidecar，保留其他名称、模型策略和所有项目文件

#### Scenario: 删除最后一个 override
- **WHEN** 用户删除全局最后一个模型 override 而 enabled 非空
- **THEN** sidecar SHALL 保留，后续运行 SHALL 继续应用全局开关

#### Scenario: 冲突或 I/O 失败
- **WHEN** 全局目标在打开详情后外部修改，或原子保存失败
- **THEN** 原文件 SHALL 保持不变，详情 SHALL 保留草稿与原指纹，不产生部分保存

### Requirement: 全局结构异常不能静默重新开启委派

用户级 settings 无法安全读取、结构或版本无效时，系统 SHALL 清空本轮执行目录并输出有界诊断，不回退全开。文件缺失 SHALL 使用缺省开启。模型策略异常 SHALL 按既有规则诊断并完整继承父策略，全局启停 SHALL 由全局配置决定。主 Agent 其他有效能力 SHALL 继续可用。

#### Scenario: 全局坏配置关闭委派
- **WHEN** 全局 settings JSON 损坏
- **THEN** 本轮 SHALL 无可执行子 Agent，主运行其他工作 SHALL 继续

### Requirement: 执行目录与工具暴露共同遵守启停快照

系统 SHALL 在主运行初始化时冻结启停结果，`listDescriptors()`、`get(name)`、provider 参数 enum 和子 runtime 创建 SHALL 使用同一已过滤目录。停用项 SHALL 不进入描述符和按名可执行查找；伪造调用 SHALL 在创建子 runtime、发布子运行 start、子任务审批或子 provider 请求之前失败。空目录 SHALL 不注册 `run_subagent`，不得输出空 `agent` enum。TUI、headless `--once` 和 schema-only 路径 SHALL 使用相同规则；`--full-access`、审批缓存和主工具开关 SHALL NOT 越过 Agent 停用决定。停用候选 SHALL 仍受原有定义数量上限计数约束。

#### Scenario: 停用目标不暴露且不能执行
- **WHEN** Worker 有效停用，provider 仍伪造 `run_subagent(agent="worker")`
- **THEN** Worker SHALL 不在本轮 enum 中，调用 SHALL 返回保留调用身份的失败结果，且 SHALL NOT 启动子运行或发起其 provider 请求

#### Scenario: 全部停用不生成空工具 schema
- **WHEN** 全部内置与有效自定义定义均停用
- **THEN** 主 registry 和 schema-only 输出 SHALL 不包含 `run_subagent`，主运行 SHALL 仍能继续
- **THEN** 伪造该工具调用 SHALL 按未注册工具边界拒绝

#### Scenario: Headless 不绕过停用
- **WHEN** `--once --full-access` 的 provider 尝试委派被停用 Agent
- **THEN** 调用 SHALL 同样失败，且 SHALL 不等待 stdin 或创建子 runtime

#### Scenario: 主工具开关仍独立有效
- **WHEN** 至少一个 Agent 启用，但主工具禁用名单包含 `run_subagent`
- **THEN** 主运行 SHALL 不暴露或执行 `run_subagent`，启用 Agent SHALL NOT 覆盖该决定

#### Scenario: 停用不扩展候选容量
- **WHEN** 扫描的自定义名称数量超过原有上限，其中部分名称停用
- **THEN** 系统 SHALL 维持既有排序、候选限额及超限诊断，不因停用释放候选名额

### Requirement: 启停不改变活动任务和历史事实

启停修改 SHALL 仅影响下一次主运行；已冻结目录 SHALL 不热重载，当前轮次内后续委派 SHALL 继续使用本轮快照。启停 SHALL NOT 触发当前子运行取消、暂停或重启，SHALL NOT 修改已持久化的子运行身份、终态和报告，也不改变父轮次取消传播和 Ctrl+O 窗口交互。

#### Scenario: 外部停用不取消当前任务
- **WHEN** 某 Agent 正在执行时，外部编辑将其启停设为 false
- **THEN** 当前子运行及当前父轮次后续委派 SHALL 使用原冻结目录，下一主运行 SHALL 应用停用

#### Scenario: 恢复会话仍展示停用 Agent 的历史
- **WHEN** 用户恢复包含现已停用 Agent 运行记录的会话
- **THEN** 历史运行与报告 SHALL 按既有规则显示，新主运行的可委派目录 SHALL 应用当前启停配置
