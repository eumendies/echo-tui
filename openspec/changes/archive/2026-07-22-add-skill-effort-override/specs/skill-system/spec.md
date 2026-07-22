## ADDED Requirements

### Requirement: skill effort 策略持久化
系统 SHALL 支持在当前生效 skill source root 的 `skills.json` 中持久化按 skill 名称配置的可选 reasoning effort override。未配置 override 的 skill SHALL 使用最终选中 model profile 的默认 effort；显式 override SHALL 是受支持的 `ReasoningEffort` 值，并 SHALL NOT 修改全局 model profile 配置。

#### Scenario: 未配置 effort 时使用模型默认值
- **WHEN** discovered skill 没有持久化 effort override
- **THEN** 系统 SHALL 将该 skill 的 effort 策略显示为“模型默认”或等价动态状态
- **THEN** direct slash invocation SHALL 使用调用开始时最终选中 model profile 的 reasoning effort

#### Scenario: 按生效 source root 读取固定 effort
- **WHEN** 当前生效 skill 所属 root 的 `skills.json` 为该 skill 保存了有效 reasoning effort
- **THEN** 系统 SHALL 将该值作为该 skill 的固定 effort 策略
- **THEN** 同名但未生效的另一 source root 状态 SHALL NOT 覆盖该策略

#### Scenario: 显式 none 与模型默认保持区分
- **WHEN** skill effort override 被显式设置为 `none`
- **THEN** 系统 SHALL 将 `none` 保留为有效固定策略
- **THEN** 系统 SHALL NOT 将其解释为缺少 override 或“模型默认”

#### Scenario: 旧状态文件保持兼容
- **WHEN** skill root 的旧 `skills.json` 不包含 effort override 字段
- **THEN** 系统 SHALL 保留该文件表达的 enabled 和 model override 状态
- **THEN** 系统 SHALL 将所有未记录 effort 策略的 skill 视为使用模型默认值

#### Scenario: 无效 effort 状态独立降级
- **WHEN** `skills.json` 的 enabled 或 model override 字段有效但 effort override 字段缺失、格式无效或包含未知值
- **THEN** 系统 SHALL 保留其他有效状态
- **THEN** 系统 SHALL 丢弃无效 effort 条目并将对应 skill 降级为模型默认值

### Requirement: 显式 slash skill invocation 使用单 turn effort 覆盖
系统 SHALL 仅在用户通过 `/<skill-name> [arguments...]` 显式调用 enabled skill 时应用该 skill 的有效 reasoning effort override。系统 SHALL 在解析最终 model profile 后合并 effort override，并 SHALL 在当前 agent turn 及其 tool continuation 中保持最终配置不变。

#### Scenario: 固定 effort 覆盖 profile 默认值
- **WHEN** 用户显式调用配置了固定 effort override 的 enabled skill
- **THEN** 当前 agent turn SHALL 使用该 override 取代最终选中 model profile 的默认 reasoning effort
- **THEN** 当前 turn 的 tool continuation SHALL 继续使用同一 effort

#### Scenario: 模型默认 effort 跟随最终 profile
- **WHEN** 用户显式调用 effort 策略为“模型默认”的 enabled skill
- **THEN** 系统 SHALL 先按普通规则或 skill model override 选出最终 model profile
- **THEN** 当前 turn SHALL 使用该 profile 自带的 reasoning effort

#### Scenario: model 与 effort override 独立生效
- **WHEN** skill 同时配置了 model profile 和 reasoning effort override
- **THEN** 系统 SHALL 使用指定 profile 的 provider、model 和 context window
- **THEN** 系统 SHALL 使用显式 effort override 取代该 profile 自带的 reasoning effort

#### Scenario: 已删除 model profile 不丢弃有效 effort
- **WHEN** skill 引用的 model profile ID 已不存在但仍包含有效 effort override
- **THEN** 系统 SHALL 回退全局当前 model profile
- **THEN** 系统 SHALL 继续把有效 effort override 应用于当前 slash skill turn

#### Scenario: effort 覆盖不改变全局配置
- **WHEN** 固定 effort 的显式 slash skill turn 完成、失败或被中断
- **THEN** 全局 model profile 的 reasoning 配置 SHALL 保持不变
- **THEN** 后续普通 user turn SHALL 使用届时的全局模型配置

#### Scenario: status line 展示最终 effort
- **WHEN** 显式 slash skill turn 应用了有效 model 或 effort override
- **THEN** status line SHALL 标记当前模型为 `SKILL override` 并展示最终有效 effort
- **THEN** 系统 SHALL 追加一条仅本地可见的本轮 override notice
- **THEN** model 与 effort 同时覆盖时系统 SHALL NOT 为同一 turn 追加重复 notice

#### Scenario: 自主 use_skill 不应用 effort 策略
- **WHEN** 进行中的 agent turn 通过 `use_skill` 加载配置了固定 effort 的 skill
- **THEN** 当前 turn SHALL 继续使用初始化时的 reasoning effort
- **THEN** 系统 SHALL NOT 因该 tool call 重建 provider 或修改后续普通 turn 配置

## MODIFIED Requirements

### Requirement: /skills 行内管理模型策略
系统 SHALL 在现有 `/skills` 单层 surface 中展示每个 skill 的模型和 effort 策略，并 SHALL 提供字段焦点以在同一行内调整两类草稿。系统 SHALL NOT 为模型或 effort 选择打开下拉列表或二级菜单。

#### Scenario: 打开 surface 时展示两类策略
- **WHEN** 用户提交纯 `/skills` 且存在 discovered skills
- **THEN** 每个 skill 行 SHALL 展示其 enabled 状态、名称、当前模型策略和当前 effort 策略
- **THEN** 未配置 model override 的 skill SHALL 展示动态“当前模型”状态
- **THEN** 未配置 effort override 的 skill SHALL 展示动态“模型默认”状态
- **THEN** surface 的初始活动字段 SHALL 为模型

#### Scenario: Tab 切换活动字段
- **WHEN** `/skills` surface 处于活跃状态且用户按 Tab 或 Shift+Tab
- **THEN** 系统 SHALL 在模型和 effort 字段之间切换焦点
- **THEN** 系统 SHALL 只更新 command session surface/data，不写入状态文件或触发 agent 请求

#### Scenario: Left 和 Right 循环切换活动策略
- **WHEN** `/skills` surface 处于活跃状态且用户按 Left 或 Right
- **THEN** 系统 SHALL 按对应方向循环更新当前选中 skill 的活动字段草稿
- **THEN** 模型候选集合 SHALL 包含动态当前模型和全部有效 model profiles
- **THEN** effort 候选集合 SHALL 包含动态模型默认值和全部受支持 `ReasoningEffort` 值
- **THEN** 系统 SHALL NOT 立即写入 `skills.json` 或触发 agent 请求

#### Scenario: 当前 profile 可被固定选择
- **WHEN** 全局当前 profile 也出现在可选 model profiles 中
- **THEN** surface SHALL 同时提供动态“当前模型”和固定到该 profile 的两个不同策略
- **THEN** 用户后续修改全局模型时，只有动态策略 SHALL 跟随变化

#### Scenario: 切换模型不重置 effort
- **WHEN** 用户已为当前 skill 选择 effort 草稿并切换其模型策略
- **THEN** 系统 SHALL 保留该 skill 的 effort 草稿
- **THEN** 切换 effort 策略也 SHALL 保留当前模型草稿

#### Scenario: 保存 enabled、模型和 effort 草稿
- **WHEN** 用户在 `/skills` 中修改 enabled 状态、模型策略或 effort 策略后按 Enter
- **THEN** 系统 SHALL 将三类草稿统一保存到各 skill 当前生效 source root 的 `skills.json`
- **THEN** 没有固定 model 或 effort override 的 skill SHALL 不写入对应映射项
- **THEN** 系统 SHALL 关闭 surface 且不触发 agent 请求

#### Scenario: 取消全部草稿
- **WHEN** 用户修改 enabled 状态、模型策略或 effort 策略后按 Esc
- **THEN** 系统 SHALL 放弃全部草稿并关闭 surface
- **THEN** 系统 SHALL NOT 修改任何 skill state 文件

#### Scenario: 模型配置不可用时仍可管理 skill
- **WHEN** `/skills` 无法读取有效 model profile 列表
- **THEN** 系统 SHALL 继续展示并允许保存 enabled/disabled 和 effort 状态
- **THEN** 模型策略 SHALL 只提供动态当前模型选项

#### Scenario: 窄终端优先展示可操作字段
- **WHEN** `/skills` surface 的终端宽度不足以完整展示 enabled 状态、两类策略、名称、来源和描述
- **THEN** renderer SHALL 先裁剪描述和非活动策略字段
- **THEN** 当前 skill 的 enabled 状态、名称和活动策略字段 SHALL 保持可识别

### Requirement: 显式 slash skill invocation 使用单 turn 模型覆盖
系统 SHALL 仅在用户通过 `/<skill-name> [arguments...]` 显式调用 enabled skill 时应用该 skill 的有效 model profile override。覆盖 SHALL 在当前 agent 调用初始化时选择完整 provider 配置，并与可选 effort override 合并；系统 SHALL NOT 修改全局模型选择或影响后续普通 turn。

#### Scenario: 固定模型执行显式 slash skill
- **WHEN** 用户显式调用配置了有效固定 model profile 的 enabled skill
- **THEN** 当前 agent turn SHALL 使用该 profile 对应的 provider、model、reasoning 配置和 context window
- **THEN** 如果 skill 还配置了 effort override，最终 reasoning effort SHALL 使用该 override
- **THEN** 当前 turn 的 tool continuation SHALL 继续使用同一模型配置

#### Scenario: 动态策略执行显式 slash skill
- **WHEN** 用户显式调用模型策略为“当前模型”的 enabled skill
- **THEN** 当前 agent turn SHALL 按普通配置规则使用调用开始时的全局当前 model profile
- **THEN** 可选 skill effort override SHALL 在该 profile 解析后独立应用

#### Scenario: 覆盖不改变全局选择
- **WHEN** 固定模型的显式 slash skill turn 完成、失败或被中断
- **THEN** `llm.selectedModel` SHALL 保持不变
- **THEN** 后续普通 user turn SHALL 使用届时的全局当前模型

#### Scenario: status line 标记当前固定覆盖
- **WHEN** 显式 slash skill turn 应用了有效固定 model profile 或 effort override
- **THEN** 系统 SHALL 在 user record 后追加一条仅本地可见的本轮 override notice
- **THEN** status line SHALL 将模型显示为 `<model> (SKILL override)` 并展示最终有效 effort
- **THEN** turn 完成、失败或被中断后 status line SHALL 恢复全局当前模型和 effort 显示

#### Scenario: 已删除 profile 回退当前模型
- **WHEN** skill state 引用的 model profile ID 在调用开始时已不存在
- **THEN** 系统 SHALL 使用全局当前 model profile 执行该 slash skill
- **THEN** 系统 SHALL NOT 因陈旧 model override 阻止 skill 加载或自动改写 skill state
- **THEN** 如果 skill 仍有有效 effort override，系统 SHALL 应用该 effort 并保留 `SKILL override` 标记
- **THEN** 如果没有其他有效 override，status line SHALL NOT 显示 `SKILL override` 标记且系统 SHALL NOT 追加 override notice
