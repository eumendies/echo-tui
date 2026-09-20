## MODIFIED Requirements

### Requirement: 内置 Agent 仅开放模型策略
Built-in 范围 SHALL 保持 `explorer` 与 `worker` 的名称、description、prompt、capability、本地工具、MCP 可见性和执行策略只读。详情 SHALL 显示 effective 模型、effort 与 Skill 策略，并 SHALL 显示这些策略当前来自用户级 override、项目级 override 还是父策略继承；已声明但因引用失效而未生效的 override SHALL 显示为未生效，且 SHALL NOT 显示为当前策略。详情 SHALL 只提供可聚焦的项目级策略配置和用户级策略配置选项，并 SHALL 在选项上标注该 scope 当前是生效、被更高优先级整体覆盖还是未配置。策略表单 SHALL 只允许 model、effort 与 Skill allowlist，并 SHALL 在保存前说明当前生效来源以及本 scope 保存后是否立即生效。移除已有 override SHALL 使用可见选项并经过与删除相同的确认流程。

#### Scenario: 配置 Explorer 项目模型与 Skills
- **WHEN** 用户在 Explorer 详情选择“配置项目级策略…”并完成 model、effort 与 Skill 表单
- **THEN** 系统 SHALL 只更新项目级内置 override settings
- **THEN** Explorer 的只读工具、MCP 禁用和固定 prompt SHALL 保持不变

#### Scenario: 为 Worker 禁止所有 Skills
- **WHEN** 用户在 Worker 内置策略表单选择明确空 Skill allowlist并保存
- **THEN** 项目级或用户级 override SHALL 持久化空 Skill 序列
- **THEN** 下一 primary run 的 Worker SHALL 保留 `use_skill` 工具但拥有空 effective Skill catalog

#### Scenario: 尝试编辑内置安全字段
- **WHEN** 用户查看任一 Built-in Agent 详情
- **THEN** surface SHALL NOT 提供编辑 description、instructions、capability、tools 或 MCP 的选项

#### Scenario: 查看内置 Agent 的生效来源
- **WHEN** 用户打开存在合法项目级 override 的内置 Agent 详情
- **THEN** 详情 SHALL 显示项目级 override 生效及其 sidecar 路径
- **THEN** 由该 override 覆盖的 model、effort 或 Skill 值 SHALL 与父策略继承值可区分
- **THEN** 用户级策略配置选项 SHALL 标注其被项目级整体覆盖

#### Scenario: 已声明的 override 未生效
- **WHEN** 生效来源中的内置 override 引用了当前配置快照中不存在的 model profile
- **THEN** 详情 SHALL 显示该 override 已声明但未生效及其原因，且 SHALL NOT 把该来源显示为当前生效策略
- **THEN** model、effort 与 Skill 策略 SHALL 显示为完整继承父策略

#### Scenario: 策略表单提示本 scope 是否生效
- **WHEN** 用户级 override 生效时用户打开同一内置 Agent 的项目级策略表单
- **THEN** 策略表单 SHALL 显示当前生效来源，并说明保存本项目级策略后将整体覆盖该来源
