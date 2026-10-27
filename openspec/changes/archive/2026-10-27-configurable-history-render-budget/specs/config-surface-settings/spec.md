## ADDED Requirements

### Requirement: 历史重绘预算配置
系统 SHALL 在 `/config` 的“常规”Tab 提供“历史重绘预算”设置，持久化字段 SHALL 为 `ui.historyRenderLineLimit`，默认值 SHALL 为 `1000`。有效值 SHALL 仅为 `500`、`1000`、`2000`、`5000`、`10000` 和 `0`，其中 `0` SHALL 显示为“不限”；缺失、非数值、非整数或不在档位集合内的值 SHALL 独立回退默认值。该设置 SHALL 只影响主会话历史重绘，不影响模型上下文。

#### Scenario: 显示与调节预算档位
- **WHEN** 用户在常规页选中历史重绘预算并按 Left 或 Right
- **THEN** 草稿 SHALL 在 500、1,000、2,000、5,000、10,000 行和不限的有序档位间移动，到两端时保持当前值
- **THEN** 页面 SHALL 展示当前行数或“不限”，并用单行 hint 说明控制恢复会话时渲染的消息行数、不影响模型上下文，实际回看范围仍受终端滚动历史上限限制
- **THEN** hint SHALL NOT 展开软预算、完整块或超限等实现细节

#### Scenario: 终端滚动历史上限与渲染预算独立
- **WHEN** 应用输出的历史超过终端自身的滚动历史（scrollback）上限，包括用户选择不限预算的情况
- **THEN** 实际可回看的范围 SHALL 仍受终端滚动历史配置限制，应用 SHALL NOT 因预算设置而修改该配置
- **THEN** 该上限 SHALL NOT 与窗口高度混淆，窗口高度只决定一屏可见行数

#### Scenario: 草稿与运行时隔离
- **WHEN** 用户修改历史重绘预算但尚未保存，或确认放弃草稿
- **THEN** 系统 SHALL NOT 修改配置文件或已生效的预算
- **THEN** 切换 Tab SHALL 保留未保存草稿，关闭时 SHALL 沿用统一 dirty 保护

#### Scenario: 保存预算保留其他配置
- **WHEN** 用户激活“保存常规设置”且草稿有效
- **THEN** 系统 SHALL 原子写入 `ui.historyRenderLineLimit`，保留其他 UI 字段和未知配置
- **THEN** 常规页 SHALL 更新 dirty 基线、显示保存反馈并保持打开

#### Scenario: 无效配置独立回退
- **WHEN** 配置字段缺失或为 `"1000"`、`750`、负数、小数、null 等非法值
- **THEN** 系统 SHALL 只将该字段回退为 1,000 行，不影响其他有效设置

#### Scenario: 零值明确表示不限
- **WHEN** 配置字段为数值 `0`
- **THEN** 系统 SHALL 使用不限，SHALL NOT 因 falsy 判断回退默认值

#### Scenario: 无效草稿不得写入
- **WHEN** 保存时历史预算草稿不属于有效档位集合
- **THEN** 配置中心 SHALL 显示可理解的校验错误且 SHALL NOT 写入配置文件

### Requirement: 历史预算变化即时刷新
系统 SHALL 通过现有共享配置 snapshot 更新历史预算，SHALL NOT 在普通渲染路径读配置文件。仅当归一化预算有效值改变且 main 为当前 owner 时，系统 SHALL 为该变化执行一次主会话破坏性重绘；仅预算变化且其他 owner 可见时 SHALL 缓存新值并在返回 main 时使用。预算变化 SHALL NOT 清空 context usage、改变模型配置、重启 assistant run 或追加 transcript record。

#### Scenario: 保存后立即采用新预算
- **WHEN** 用户保存较大、较小或不限预算且当前展示主会话
- **THEN** 系统 SHALL 重新选择并显示对应历史范围
- **THEN** 配置 surface 的打开状态、焦点、反馈和其他 Tab 草稿 SHALL 保持有效

#### Scenario: 外部配置变更和重复通知
- **WHEN** watcher 检测到有效预算变化
- **THEN** 系统 SHALL 从共享 snapshot 应用新值并按当前 owner 更新显示

#### Scenario: 同值通知不重复重绘
- **WHEN** 后续通知仍归一化为相同预算
- **THEN** 系统 SHALL NOT 为该同值通知重复清屏重绘

#### Scenario: 后台主会话不覆盖独立视图
- **WHEN** 仅预算发生变化且 BTW 或子 Agent 独立视图正在显示
- **THEN** 系统 SHALL NOT 用主会话历史覆盖当前视图
- **THEN** 返回 main 后 SHALL 使用新预算

## MODIFIED Requirements

### Requirement: Reasoning summary 可见性设置
系统 SHALL 将 `ui.showReasoningSummary` 作为 `reasoning_summary` transcript record 的纯显示偏好。关闭时 append render、destructive replay 和 final render SHALL 隐藏 reasoning summary；系统仍 SHALL 保存和恢复完整 record，并保持其非 provider-facing、非上下文压缩输入语义。主会话破坏性重绘 SHALL 先应用该可见性偏好，再按历史重绘预算选择可见块后缀。

#### Scenario: 关闭后隐藏新增 reasoning summary
- **WHEN** `showReasoningSummary` 为 false 且 provider 返回 reasoning summary
- **THEN** 系统 SHALL 把 `reasoning_summary` record 追加到 transcript 和 session journal
- **THEN** 当前 transcript 可见输出 SHALL NOT 渲染该 summary block

#### Scenario: 关闭后恢复 session
- **WHEN** session 中包含历史 `reasoning_summary` records 且当前显示开关为 false
- **THEN** destructive replay 和 final render SHALL 跳过这些 summary block
- **THEN** records SHALL 继续保留在恢复后的完整 transcript 状态中
- **THEN** 被隐藏 summary SHALL NOT 消耗主会话历史行数预算

#### Scenario: 重新开启恢复历史 summary
- **WHEN** 用户把 reasoning summary 显示从 false 保存为 true
- **THEN** 系统 SHALL 执行完整可见快照重绘
- **THEN** 位于当前主会话历史预算所选范围内的 summary SHALL 重新可见，不在所选范围内的 summary SHALL 保留原始记录

#### Scenario: 显示偏好不改变模型语义
- **WHEN** 用户切换 reasoning summary 显示开关
- **THEN** 系统 SHALL NOT 改变模型 profile 的 `reasoning.summary` 请求配置
- **THEN** 系统 SHALL NOT 把 reasoning summary 加入 provider request、token 估算或压缩摘要输入

### Requirement: 常规设置即时刷新
TUI SHALL 在 app 创建时从实例级用户配置 snapshot 读取一次归一化常规设置并缓存到实例状态。配置中心保存或 `config.json` watcher 检测到设置变化时，系统 SHALL 从同一次共享配置刷新产生的新 snapshot 更新缓存，并根据变化类型执行必要重绘或清理已失效的 context usage；普通 render 热路径 SHALL NOT 同步读取配置文件。同一 watcher 通知 SHALL NOT 为刷新模型与常规设置分别重复读取 `config.json`。

#### Scenario: Slash 上限变化只重绘 footer
- **WHEN** 只有 slash suggestion 上限变化，reasoning summary 可见性及历史重绘预算均未变化
- **THEN** 系统 SHALL 使用新上限重绘 footer
- **THEN** 系统 SHALL NOT 为该变化清空 transcript 或追加 record

#### Scenario: Reasoning 可见性变化完整重绘
- **WHEN** reasoning summary 可见性发生变化
- **THEN** 系统 SHALL 执行 destructive replay 以重新投影现有 transcript
- **THEN** 重绘 SHALL 使用当前 theme、终端宽度及当前 owner 的有效记录；主会话 SHALL 从驻留活跃记录中先按 reasoning 可见性过滤，再按历史预算选择完整块后缀，不为显示偏好回读已压缩原文

#### Scenario: 只有压缩阈值变化
- **WHEN** 只有自动压缩阈值发生变化
- **THEN** 系统 SHALL NOT 因该变化执行不必要的 transcript 重绘
- **THEN** 下一次 assistant run SHALL 使用新阈值

#### Scenario: 技能列表上下文占比上限变化
- **WHEN** 技能列表上下文占比上限发生变化
- **THEN** 当前 active assistant run SHALL 继续使用启动时的 catalog 投影
- **THEN** 下一次 assistant run SHALL 使用新比例和当前模型 context window 创建 catalog 投影
- **THEN** 系统 SHALL 清理旧的 context usage 快照
- **THEN** 系统 SHALL NOT 因该变化执行不必要的 transcript 重绘或追加 record

#### Scenario: watcher 同时更新模型和常规设置
- **WHEN** 一次配置文件变化同时修改模型配置和常规设置
- **THEN** TUI SHALL 通过一次用户配置刷新得到包含两个领域变化的新 snapshot
- **THEN** ModelContext 与 App settings cache SHALL 消费同一 revision 且 SHALL NOT 各自重新读取配置文件
