## Why

Subagent 目前只能控制是否暴露 `use_skill` 工具，不能限制该工具具体可加载哪些 Skill；同时子运行的 system prompt 继承父模型已裁剪的 Skill catalog，而执行端重新创建 SkillManager，存在可见目录与实际加载范围不一致的问题。需要为每个内置和自定义 Subagent 增加稳定、可管理、按父运行冻结的 Skill allowlist，使 Skill 暴露范围与既有模型、effort、工具和 MCP 策略一样可配置。

## What Changes

- 为自定义 Subagent Markdown manifest 增加可选 `skills` 名称序列；缺省表示允许全部全局 enabled Skills，空序列表示全部禁止，非空序列表示按名称允许。
- 为内置 `explorer` 和 `worker` 的用户级、项目级 override 增加同样的 Skill 策略，并兼容读取现有 settings schema。
- 在父 assistant run 启动时冻结完整 enabled Skill 视图，为每次子运行按定义创建 scoped Skill registry；system prompt catalog 与 `use_skill` 加载必须使用同一作用域。
- 由 Subagent 的实际模型 context window 独立计算其 Skill catalog 投影，不再复用父模型已经裁剪的投影。
- 扩展 `/agents` 管理界面，使自定义和内置 Agent 都能查看、选择、清空或恢复“全部 enabled Skills”的策略，并保留暂时缺失或 disabled 的已配置名称供诊断和再次编辑。
- 当 Subagent 未获得 `use_skill` 工具时强制使用空的 effective Skill catalog；配置 Skill 名称不会授予文件、Bash、MCP 或其他工具权限。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `custom-subagent-definitions`: 自定义 manifest、内置 override、冻结目录和运行时定义增加 Skill allowlist 策略。
- `agents-command`: `/agents` 列表、详情和表单支持查看及编辑 Subagent Skill 策略。
- `skill-system`: Skill catalog 与 `use_skill` 支持来自同一运行快照的 scoped 可见性和加载拒绝。
- `readonly-subagent-delegation`: Explorer 与自定义 readonly Subagent 使用定义约束后的独立 Skill catalog。
- `general-purpose-worker-subagent`: Worker 与自定义 general Subagent 使用定义约束后的独立 Skill catalog。

## Impact

- 影响 Subagent 定义、manifest parser/serializer、内置 settings schema、catalog loader 和管理存储。
- 影响 Agent 装配、父子 loop runtime、SkillManager/SkillRegistry 注入及 Skill catalog 预算投影。
- 影响 `/agents` command 状态、command port、footer surface 与相关类型。
- 需要覆盖旧 manifest/settings 兼容、来源优先级、disabled/缺失/同名覆盖 Skill、headless、运行快照稳定性以及 prompt/handler 同源性的测试。
- 不引入第三方依赖，不改变 Skill 所依赖工具的风险分类和审批边界；Skill allowlist 是 `use_skill` 暴露边界，不是底层文件路径保密机制。
