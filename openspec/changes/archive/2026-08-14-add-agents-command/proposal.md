## Why

Echo TUI 已能从用户级与项目级 Markdown 文件发现自定义 Subagent，但缺少可发现、可校验的管理入口，用户只能手工编辑文件，也无法为不同 Subagent 选择适合的模型与推理强度。新增 `/agents` 可以把定义、来源覆盖、诊断和运行策略集中到 TUI 中管理，同时保持现有权限上限与每轮冻结目录的安全边界。

## What Changes

- 新增 `/agents` command，提供 Overview、Project、User 与 Built-in 范围中的 Agent 列表、详情、诊断和来源覆盖状态。
- 支持在 TUI 中创建、编辑和删除用户级、项目级自定义 Agent，管理 description、capability、本地工具、MCP、模型、effort 与 Markdown instructions。
- 新建、保存、删除等动作作为可选择的界面选项展示；用户移动到选项并按 Enter 后进入表单或确认步骤，不使用 `a`、`d` 等隐藏快捷键直接触发变更。
- 内置 `explorer` 与 `worker` 保持名称、description、prompt、权限模板和工具集合不可修改，只允许配置独立模型与 effort。
- 扩展自定义 Agent manifest，使其可选地引用模型 profile，并区分继承父 effort、采用目标模型默认 effort 与固定 effort override。
- 对 Agent 文件执行严格校验、原子写入、外部修改冲突检测和安全路径约束；无效、被覆盖和保留名称文件仍可在管理界面中诊断或删除。
- 保存结果只影响下一次 primary assistant run；不会改变当前已冻结的 Subagent catalog。

## Capabilities

### New Capabilities
- `agents-command`: 定义 `/agents` 管理界面的范围导航、列表与详情、显式动作选项、确认流程、CRUD、内置 Agent override、诊断和保存反馈。

### Modified Capabilities
- `custom-subagent-definitions`: 扩展自定义 Subagent 定义与冻结目录，使其支持严格的模型 profile 和 effort 策略，并定义管理写入、冲突保护及运行时解析语义。

## Impact

- 影响 `src/commands/`、`src/app/command/`、`src/render/footer/` 与 `src/types/command.ts` 的 command session、受控端口和 `agents` surface。
- 影响 `src/agent/subagent/` 的 manifest、目录、定义模型与运行端口，以及 `src/agent/loop-runtime/` 和 LLM profile 严格解析路径。
- 新增用户级与项目级 Agent 管理持久化逻辑，以及用于内置 Agent 模型/effort override 的版本化设置文件。
- 需要补充 command controller、surface renderer、manifest/catalog、文件存储、模型解析、TUI 与 `--once` 一致性的自动化测试，并更新 README 和架构文档。
- 不引入第三方 TUI、YAML 或文件监听依赖，不改变 transcript 格式、委派深度、每轮委派预算、工具审批或 headless 安全策略。
