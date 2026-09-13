## ADDED Requirements

### Requirement: Subagent catalog 与 Skill 加载共享运行作用域
系统 SHALL 在每次 primary assistant run 初始化时从同一个 SkillManager 捕获不可变 enabled Skill snapshot，该 snapshot SHALL 包含按既有来源优先级胜出的原始 catalog、正文和资源加载结果。Primary catalog、Primary `use_skill` 以及该父运行创建的所有 Subagent scoped registries SHALL 从同一 snapshot 派生；运行中的 Skill 文件、资源或 enabled 状态变化 SHALL 只影响后续 primary run。每个 Subagent scoped registry SHALL 用同一允许名称集合实现 `listCatalog()` 与 `loadSkill()`，失败结果中列出的 available Skills SHALL 也限制在该 scope 内。

#### Scenario: Prompt 与加载使用同一 scope
- **WHEN** Subagent 的 effective Skill 集合只包含 `code-review`
- **THEN** system prompt catalog SHALL 只公布 `code-review`
- **THEN** `use_skill` SHALL 能加载 `code-review`，并 SHALL 拒绝同一父 snapshot 中其他 Skill 名称

#### Scenario: 未授权加载不泄露隐藏目录
- **WHEN** Subagent 调用 `use_skill` 请求不在自身 effective 集合中的名称
- **THEN** tool result SHALL 标记失败且不包含目标 Skill 正文、资源或来源路径
- **THEN** 失败结果的 available Skills SHALL 只包含该 Subagent scope 中允许的名称

#### Scenario: 父运行期间修改 Skill 状态
- **WHEN** primary run 已捕获 snapshot 后，用户禁用 Skill、修改 `SKILL.md` 或替换资源
- **THEN** 当前 primary continuation 与后续 Subagent 委派 SHALL 继续使用原 snapshot
- **THEN** 下一 primary run SHALL 捕获届时生效的新状态和内容

#### Scenario: 同名 Skill 使用冻结时的有效来源
- **WHEN** allowlist 包含一个同时存在 project、user 或 builtin 定义的 Skill 名称
- **THEN** scoped registry SHALL 使用父 snapshot 中按既有优先级胜出的单个定义
- **THEN** allowlist SHALL NOT 跨来源合并元数据、正文或资源

### Requirement: Subagent 按自身模型预算 Skill catalog
每个 Subagent runtime SHALL 在最终模型配置和 effective Skill scope 已解析后，使用自身 context window 与当前 run 冻结的 catalog context ratio 创建一次 provider-facing Skill catalog 投影。该投影 SHALL 在该子运行的全部 continuation 中复用，并 SHALL NOT 复用父模型已经 truncated 或 names-only 的投影。Primary run SHALL 继续独立使用自己的模型窗口生成投影。

#### Scenario: 父子模型窗口不同
- **WHEN** Subagent 使用与父 Agent 不同 context window 的模型
- **THEN** 子 catalog SHALL 从 scoped 原始 metadata 按子模型窗口重新计算预算和截断模式
- **THEN** 父 catalog 的 description 截断结果 SHALL NOT 成为子投影的输入

#### Scenario: 子运行 continuation 保持稳定
- **WHEN** Subagent 因一次或多次工具调用产生 provider continuation
- **THEN** 每次 continuation SHALL 使用该子运行初始化时创建的同一 catalog 投影
- **THEN** system context SHALL NOT 因运行中配置或上下文增长重新计算 Skill 集合
