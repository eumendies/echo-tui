## 1. 定义模型与 Manifest 解析

- [x] 1.1 重构 `SubagentDefinition`，使用可冻结的本地工具数组，并提取内置名称、能力上限和通用基础 prompt 常量；保持 Explorer 与 Worker 现有定义和行为不变。
- [x] 1.2 实现自定义 Agent 名称校验与安全显示格式化纯函数，覆盖长度、小写字符规则、控制字符拒绝、内置专属文案和通用回退。
- [x] 1.3 实现无第三方依赖的严格 Markdown manifest 解析器，支持 description、capability、tools 列表、可选 mcp 与非空正文，并拒绝未知/重复字段、错误类型和不支持的 YAML 结构。
- [x] 1.4 实施文件、正文、description 及名称预算，把解析失败归一化为不包含正文的结构化诊断，并在 Catalog 边界统一限制诊断输出。
- [x] 1.5 增加 manifest 与名称纯函数测试，覆盖合法 readonly/general、引号、换行、CRLF、缺失字段、未知字段、重复工具、越权工具、超限输入及恶意控制字符。

## 2. 分层目录发现与冻结 Catalog

- [x] 2.1 实现用户级 `~/.echo/agents/*.md` 和项目级 `<project>/.echo/agents/*.md` 路径解析，复用现有项目根发现语义，并为目录、文件和 home 解析提供测试依赖注入。
- [x] 2.2 实现确定性目录扫描和 candidate 合并，忽略子目录与非 Markdown 文件，应用项目高于用户、内置名称保留及无效高优先级定义遮蔽低优先级定义的规则。
- [x] 2.3 将有效 manifest 映射为 readonly/general 解析后定义，校验工具只能位于对应 capability ceiling 内，处理 `file_edit` 逻辑能力与 MCP 开关，并生成结构化诊断。
- [x] 2.4 实现不可变 `SubagentCatalog`，以同一实例提供 descriptor 列表、按名称解析和诊断，限制自定义定义总数且不暴露可变 Map、Set 或定义引用。
- [x] 2.5 增加 Catalog 测试，覆盖目录缺失/不可读、排序、来源路径、跨层覆盖、内置名称冲突、无效遮蔽、数量上限、定义深度不可变和两次加载反映文件变化。

## 3. 父运行装配与委派端口

- [x] 3.1 在每个 primary assistant run 初始化时加载一次 Catalog，并把冻结实例注入 run-scoped `SubagentToolPort`；BTW和子运行继续不获得委派端口。
- [x] 3.2 移除端口对模块级静态定义查找的依赖，让 `listDefinitions()`、`run_subagent` enum、按名称运行和 runtime factory 全部消费同一个 Catalog。
- [x] 3.3 更新 `run_subagent` 通用描述和参数目录，使其不再声称只支持内置 Subagent，并保持未知/无效名称在 provider 请求前失败。
- [x] 3.4 将 Catalog 诊断接入现有 debug/observation 边界，确保普通 transcript、provider context和最终回答不重复持久化定义警告或泄漏文件正文。
- [x] 3.5 扩展工具handler和主runtime测试，验证 schema/执行同源、活动run修改或删除文件不改变本轮定义、下一run重新发现、四次预算、取消传播和内置委派回归。

## 4. 自定义子 Runtime 能力与安全策略

- [x] 4.1 为自定义 readonly/general 定义组合系统拥有的基础约束与 manifest 正文，保证正文仅作为 role prompt section，委派任务仍是独立子 transcript 的唯一 user record。
- [x] 4.2 更新子 registry 装配，将定义工具数组转换为当前配置下真实 handler allowlist；`file_edit` 只暴露当前选择的编辑工具，provider schema与executor保持同源。
- [x] 4.3 按定义控制 MCP 合并：readonly强制禁用，general仅在显式开启时借用父 MCP manager；所有子 registry继续排除 `run_subagent`。
- [x] 4.4 验证 readonly自定义Agent沿用严格Bash与headless fail-closed，general自定义Agent沿用normal/plan、共享审批、headless deny/full-access、Todo和用户问题语义，prompt不得扩大授权。
- [x] 4.5 扩展Subagent runtime测试，覆盖最小工具子集、越权定义不暴露、伪造未授权/嵌套调用失败、MCP开关、父模型与reasoning继承、独立continuation/Todo/compaction及配置revision稳定性。

## 5. TUI 投影、恢复与协议隔离

- [x] 5.1 更新外层 `run_subagent` 紧凑pair renderer，安全显示合法自定义名称和通用完成/失败文案，同时保留Explorer与Worker现有专属文案和结果正文去重。
- [x] 5.2 让rail、footer pending、审批和用户问题surface统一消费安全Agent身份；旧记录或损坏参数中的非法名称使用通用回退且不得输出控制字符或越过终端宽度。
- [x] 5.3 增加renderer与App交互测试，覆盖自定义名称的start、streaming、内部工具、审批、提问、completed/failed、resize replay、迟到callback隔离和窄终端投影。
- [x] 5.4 扩展provider converter、压缩、conversation reference和journal恢复回归测试，确认自定义Agent内部过程继续只作为本地`subagent` records，主provider只看到外层call/result且无需journal迁移。

## 6. Headless、文档与完整验证

- [x] 6.1 增加 `--once` 覆盖，验证用户级/项目级自定义Agent使用同一Catalog，目录缺失不阻断启动，general审批遵守deny/full-access且readonly未知Bash不因full-access放行。
- [x] 6.2 更新用户文档和架构文档，说明目录优先级、严格frontmatter格式、工具能力名称、readonly/general边界、MCP行为、运行期冻结、诊断方式及第一版非目标，并提供可复制示例。
- [x] 6.3 运行 `npm run typecheck` 并修复所有类型错误。
- [x] 6.4 运行 `npm test` 并修复全部自动测试失败。
- [x] 6.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 并确认脚本语法检查通过。
- [x] 6.6 由用户手动验证TUI中的内置与自定义委派、流式rail、内部工具、审批/提问、Esc取消、resize/resume，以及normal/plan与`--once`安全边界。
