## ADDED Requirements

### Requirement: 通用 Subagent 使用定义约束后的 Skill 作用域
内置 Worker 与自定义 general Subagent SHALL 从父运行冻结的 enabled Skill snapshot 派生独立 scoped registry，并 SHALL 应用各自定义的 Skill allowlist。Worker 保留 `use_skill` 工具不等于允许全部 Skill；provider catalog 和实际加载范围 SHALL 以 effective scope 为准。Skill scope SHALL NOT 改变 Worker 的文件编辑、Bash、Todo、提问、MCP、normal/plan、interactive/headless 或审批语义。

#### Scenario: Worker 只允许任务相关 Skill
- **WHEN** Worker 定义只允许 `code-review` 且父 snapshot 还包含其他 enabled Skills
- **THEN** Worker system prompt SHALL 只公布 `code-review`
- **THEN** Worker 对其他 Skill 的 `use_skill` 调用 SHALL 失败且不影响后续 continuation

#### Scenario: Worker Skill 不授予额外工具
- **WHEN** Worker 加载的允许 Skill 指示调用一个未注册本地工具或不可用 MCP tool
- **THEN** provider-visible schema与 executable registry SHALL 保持 Worker 定义及当前模式规定的范围
- **THEN** Skill 正文 SHALL NOT 绕过 normal、plan 或 headless 审批策略

#### Scenario: 连续 Worker 委派复用快照但隔离 scope
- **WHEN** 同一父 run 先后委派两个使用不同 Skill 策略的 Worker 或 general 自定义 Agent
- **THEN** 两次运行 SHALL 从同一冻结父 snapshot 派生各自 scoped registry
- **THEN** 第二次运行 SHALL NOT 继承第一次运行的允许名称、已加载正文或 tool continuation
