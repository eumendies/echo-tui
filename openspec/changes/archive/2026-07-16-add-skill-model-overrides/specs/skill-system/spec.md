## ADDED Requirements

### Requirement: skill 模型策略持久化
系统 SHALL 支持在当前生效 skill source root 的 `skills.json` 中持久化按 skill 名称配置的可选 model profile override。未配置 override 的 skill SHALL 在每次显式调用时动态使用全局当前模型；固定 override SHALL 引用 LLM model profile ID，且 SHALL NOT 包含 provider 凭据或改写 `llm.selectedModel`。

#### Scenario: 未配置模型时跟随当前模型
- **WHEN** discovered skill 没有持久化 model profile override
- **THEN** 系统 SHALL 将该 skill 的模型策略显示为“当前模型”或等价动态状态
- **THEN** 用户显式调用该 skill 时 SHALL 使用调用开始时的全局当前 model profile

#### Scenario: 按生效 source root 读取固定模型
- **WHEN** 当前生效 skill 所属 root 的 `skills.json` 为该 skill 保存了有效 model profile ID
- **THEN** 系统 SHALL 将该 profile 作为该 skill 的固定模型策略
- **THEN** 同名但未生效的另一 source root 状态 SHALL NOT 覆盖该策略

#### Scenario: 旧状态文件保持兼容
- **WHEN** skill root 包含只有 `schemaVersion` 和 `disabled` 的旧状态文件
- **THEN** 系统 SHALL 保留该文件表达的 enabled/disabled 状态
- **THEN** 系统 SHALL 将所有未记录模型策略的 skill 视为使用当前模型

#### Scenario: 无效模型状态独立降级
- **WHEN** `skills.json` 的 disabled 字段有效但 model override 字段缺失或格式无效
- **THEN** 系统 SHALL 保留有效的 enabled/disabled 状态
- **THEN** 系统 SHALL 将该 root 的无效模型配置降级为空 override

### Requirement: /skills 行内管理模型策略
系统 SHALL 在现有 `/skills` 单层 surface 中展示每个 skill 的模型策略，并 SHALL 使用 Left/Right 在“当前模型”和已配置 model profiles 之间循环切换当前选中 skill 的草稿策略。系统 SHALL NOT 为模型选择打开下拉列表或二级菜单。

#### Scenario: 打开 surface 时展示模型策略
- **WHEN** 用户提交纯 `/skills` 且存在 discovered skills
- **THEN** 每个 skill 行 SHALL 展示其 enabled 状态、名称和当前模型策略
- **THEN** 未配置 override 的 skill SHALL 展示动态“当前模型”状态
- **THEN** 固定 override SHALL 展示可识别的 model profile label

#### Scenario: Left 和 Right 循环切换策略
- **WHEN** `/skills` surface 处于活跃状态且用户按 Left 或 Right
- **THEN** 系统 SHALL 按对应方向循环更新当前选中 skill 的模型策略草稿
- **THEN** 候选集合 SHALL 包含动态当前模型和全部有效 model profiles
- **THEN** 系统 SHALL NOT 立即写入 `skills.json` 或触发 agent 请求

#### Scenario: 当前 profile 可被固定选择
- **WHEN** 全局当前 profile 也出现在可选 model profiles 中
- **THEN** surface SHALL 同时提供动态“当前模型”和固定到该 profile 的两个不同策略
- **THEN** 用户后续修改全局模型时，只有动态策略 SHALL 跟随变化

#### Scenario: 保存 enabled 和模型草稿
- **WHEN** 用户在 `/skills` 中修改 enabled 状态或模型策略后按 Enter
- **THEN** 系统 SHALL 将两类草稿统一保存到各 skill 当前生效 source root 的 `skills.json`
- **THEN** 没有固定 override 的 skill SHALL 不写入模型映射项
- **THEN** 系统 SHALL 关闭 surface 且不触发 agent 请求

#### Scenario: 取消全部草稿
- **WHEN** 用户修改 enabled 状态或模型策略后按 Esc
- **THEN** 系统 SHALL 放弃两类草稿并关闭 surface
- **THEN** 系统 SHALL NOT 修改任何 skill state 文件

#### Scenario: 模型配置不可用时仍可管理 skill
- **WHEN** `/skills` 无法读取有效 model profile 列表
- **THEN** 系统 SHALL 继续展示并允许保存 enabled/disabled 状态
- **THEN** 模型策略 SHALL 只提供动态当前模型选项

### Requirement: 显式 slash skill invocation 使用单 turn 模型覆盖
系统 SHALL 仅在用户通过 `/<skill-name> [arguments...]` 显式调用 enabled skill 时应用该 skill 的有效 model profile override。覆盖 SHALL 在当前 agent 调用初始化时选择完整 provider 配置，并 SHALL NOT 修改全局模型选择或影响后续普通 turn。

#### Scenario: 固定模型执行显式 slash skill
- **WHEN** 用户显式调用配置了有效固定 model profile 的 enabled skill
- **THEN** 当前 agent turn SHALL 使用该 profile 对应的 provider、model、reasoning 配置和 context window
- **THEN** 当前 turn 的 tool continuation SHALL 继续使用同一模型配置

#### Scenario: 动态策略执行显式 slash skill
- **WHEN** 用户显式调用模型策略为“当前模型”的 enabled skill
- **THEN** 当前 agent turn SHALL 按普通配置规则使用调用开始时的全局当前 model profile

#### Scenario: 覆盖不改变全局选择
- **WHEN** 固定模型的显式 slash skill turn 完成、失败或被中断
- **THEN** `llm.selectedModel` SHALL 保持不变
- **THEN** 后续普通 user turn SHALL 使用届时的全局当前模型

#### Scenario: status line 标记当前固定覆盖
- **WHEN** 配置了有效固定 model profile 的显式 slash skill turn 正在执行
- **THEN** 系统 SHALL 在 user record 后追加一条仅本地可见的模型切换 notice，并说明覆盖仅限本轮
- **THEN** status line SHALL 将模型显示为 `<model> (SKILL override)`，而不是把 override 标记渲染成独立状态项
- **THEN** turn 完成、失败或被中断后 status line SHALL 恢复全局当前模型显示

#### Scenario: 已删除 profile 回退当前模型
- **WHEN** skill state 引用的 model profile ID 在调用开始时已不存在
- **THEN** 系统 SHALL 使用全局当前 model profile 执行该 slash skill
- **THEN** 系统 SHALL NOT 因陈旧 override 阻止 skill 加载或自动改写 skill state
- **THEN** status line SHALL NOT 显示 `SKILL override` 标记
- **THEN** 系统 SHALL NOT 追加模型切换 notice

### Requirement: 自主 use_skill 不触发模型切换
模型自主发起的 `use_skill` tool call SHALL 只加载 skill instructions 和 resources，且 SHALL NOT 读取或应用该 skill 的 model profile override。

#### Scenario: 普通 turn 自主加载配置了固定模型的 skill
- **WHEN** 普通 agent turn 中模型调用 `use_skill` 加载一个配置了固定 override 的 skill
- **THEN** agent turn SHALL 继续使用初始化时的当前模型
- **THEN** 系统 SHALL NOT 重建 provider 或切换到该 skill 的固定模型

#### Scenario: slash skill turn 中自主加载另一个 skill
- **WHEN** 显式 slash skill turn 已使用单 turn 模型覆盖
- **AND** 模型随后通过 `use_skill` 加载另一个具有不同 override 的 skill
- **THEN** 当前 turn SHALL 继续使用显式 slash invocation 初始化时选择的模型
- **THEN** 另一个 skill 的 override SHALL NOT 在 tool continuation 中生效
