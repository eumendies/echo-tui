## ADDED Requirements

### Requirement: 只读 Subagent 使用定义约束后的 Skill 作用域
内置 Explorer 与自定义 readonly Subagent SHALL 从父运行冻结的 enabled Skill snapshot 派生独立 scoped registry，并 SHALL 应用各自定义的 Skill allowlist。Skill scope SHALL 只影响 catalog 与 `use_skill` 加载，不得改变严格只读 Bash 分类、MCP 禁用、文件编辑禁用、提问禁用、Todo 禁用或单层委派限制。并行只读 Subagent SHALL 可共享不可变父 snapshot，但每个运行 SHALL 使用自身定义和模型生成独立 scope 与 catalog 投影。

#### Scenario: 两个并行只读 Agent 使用不同 Skills
- **WHEN** 同一并行段启动两个 readonly Subagent且它们配置不同 Skill allowlist
- **THEN** 每个 provider prompt与`use_skill` handler SHALL 只暴露各自 effective Skill 集合
- **THEN** 两个 scoped registry SHALL NOT 因共享父 snapshot而合并允许名称

#### Scenario: Skill 指令不能放宽 readonly 边界
- **WHEN** Explorer 加载的允许 Skill 要求编辑文件、调用 MCP 或再次委派
- **THEN** 对应工具 SHALL 仍不出现在 provider-visible 和 executable registry 中
- **THEN** Skill 正文 SHALL NOT 被解释为授权或改变 Bash 风险分类

#### Scenario: readonly 自定义 Agent 不含 use_skill
- **WHEN** readonly 自定义定义省略 `use_skill` 本地工具但配置缺省或显式 Skill allowlist
- **THEN** 子运行 SHALL 使用空 Skill catalog且 provider schema SHALL 不包含 `use_skill`
- **THEN** 系统 SHALL 保持其余声明的只读工具不变
