## Why

当前 `run_subagent` 只能调用代码内置的 `explorer` 与 `worker`，用户无法为特定项目沉淀代码审查、文档编写或领域调查等专用角色。需要在保留现有隔离、审批和单层委派安全边界的前提下，支持可版本控制的用户级与项目级 Subagent 定义。

## What Changes

- 新增用户级 `~/.echo/agents/*.md` 与项目级 `<project>/.echo/agents/*.md` 定义发现，项目级同名定义优先于用户级定义。
- 使用 Markdown frontmatter 声明描述、能力模板、本地工具 allowlist 与 MCP 可见性，正文作为专属角色指令；文件名作为稳定 Agent 名称。
- 在每个父 assistant run 启动时一次性解析、校验并冻结可委派目录，使 `run_subagent` schema 与实际执行定义始终同源。
- 自定义定义只能在 `readonly` 或 `general` 能力上限内收窄工具权限；内置 `explorer`、`worker` 名称与所有 runtime 安全策略不可覆盖。
- 自定义 Agent 继续继承父 run 捕获的模型、reasoning、cwd、项目指令、memory 与 skill catalog；第一版不支持定义级模型覆盖、管理 UI、递归或并行委派。
- 扩展现有 Subagent transcript、footer、审批/提问 surface 和外层紧凑结果，使其安全显示任意合法自定义 Agent 名称。
- 增加无效定义诊断、输入大小与数量限制；无效高优先级定义不得静默回退到同名低优先级定义。

## Capabilities

### New Capabilities
- `custom-subagent-definitions`: 定义用户级和项目级 Subagent 文件的发现、格式、优先级、校验、运行期冻结及权限收窄规则。

### Modified Capabilities
- `readonly-subagent-delegation`: 将 `run_subagent` 的动态目录从仅内置定义扩展为本轮冻结的内置与有效自定义定义，并让子 runtime 执行自定义能力模板和工具 allowlist。
- `subagent-transcript-rendering`: 要求所有 Subagent 可见投影安全显示合法自定义名称，而不再只对 Explorer 与 Worker 提供具名结果。

## Impact

- 主要影响 `src/agent/subagent/` 的定义目录、manifest 解析和运行端口，以及 `src/agent/loop-runtime/agent-loop-runtime.ts`、`subagent-loop-runtime.ts` 的 run-scoped 装配。
- `src/tools/run-subagent-tool-handler.ts` 将从冻结目录生成 schema；`src/render/tool-message-renderer.ts` 等展示层将支持任意已校验名称。
- 新增用户和项目文件约定及对应测试、文档；不新增第三方依赖，不改变 transcript journal 结构，也不把 Agent 文件纳入 `~/.echo/config.json` revision。
