## 1. Agent 定义与模型策略

- [x] 1.1 扩展自定义 Agent manifest 领域类型和严格 parser，支持可选 model 与 inherit/default/固定 effort，并覆盖未知字段、非法值、预算和旧 manifest 兼容测试。
- [x] 1.2 实现自定义 Agent manifest 的规范化 serializer，固定字段顺序与换行，保留 Markdown instructions，并增加 parser/serializer 往返测试。
- [x] 1.3 扩展 `SubagentDefinition` 与冻结逻辑，表达模型 profile 和 effort 策略，同时保持 capability、工具、MCP 与基础 prompt 的现有安全边界。
- [x] 1.4 为用户配置 snapshot 增加非敏感模型目录和严格“profile + effort”解析能力，保证显式失效 profile 不会宽松回退，并补充配置解析测试。

## 2. Catalog 与运行时集成

- [x] 2.1 让 Subagent catalog 使用同一父 run 配置 snapshot 校验自定义 Agent 的显式模型引用，并为失效 profile 生成有界诊断、排除 provider schema。
- [x] 2.2 实现 inherit、default 和固定 effort 的最终解析规则，并让子 runtime 按冻结定义覆盖或继承父模型选择。
- [x] 2.3 增加版本化 `agents.settings.json` parser/store，严格限制 Explorer/Worker 的 model/effort 字段并实现项目级整体覆盖、无效高优先级 fail-closed 语义。
- [x] 2.4 将内置 Agent effective override 合并到每父 run 冻结目录，验证其不会改变内置 prompt、工具、MCP、审批或执行策略。
- [x] 2.5 扩展 Subagent runtime、TUI 与 `--once` 测试，覆盖显式模型、三类 effort 策略、失效引用、配置 revision 稳定性和 headless 安全边界。

## 3. Agent 管理存储与端口

- [x] 3.1 实现面向物理 Agent 文件的管理读取模型，返回 Built-in/User/Project 项、来源路径、有效状态、覆盖关系、诊断、内容指纹和结构化草稿。
- [x] 3.2 实现 user/project 定义创建、更新与删除，校验 scope、名称、保留名、目录边界、普通文件和符号链接，并复用 runtime manifest/capability/model校验。
- [x] 3.3 为定义和内置 override 实现同目录临时文件原子写入、排他创建、更新删除指纹冲突、失败清理。
- [x] 3.4 新增 `AgentsCommandPort`，封装列表、校验、创建、更新、删除和内置 override 操作，返回结构化成功、冲突、校验与 I/O 结果。

## 4. `/agents` Command 控制器

- [x] 4.1 在 command 类型、host 组合根和 slash command resolver 中注册 `/agents`、受控端口及独立 `agents` surface。
- [x] 4.2 实现 Overview/Project/User/Built-in 范围导航、Agent/动作混合行选择、详情层级、选择钳制、刷新和 Esc 逐层返回。
- [x] 4.3 实现自定义 Agent 创建与编辑表单，包括 name、description、capability、model、effort、tools、MCP 和多行 instructions 草稿。
- [x] 4.4 实现内置 Agent 项目级/用户级模型策略表单，确保详情不暴露复制入口且内置安全字段只读。
- [x] 4.5 将新建、编辑、保存、删除和移除 override 全部实现为可聚焦动作选项与 Enter 激活，不注册 `a`、`d`、`e` 字符快捷操作。
- [x] 4.6 为创建、删除和移除 override 实现默认聚焦取消的确认状态，展示 scope、路径和低优先级重新生效提示，并在取消后保留草稿。
- [x] 4.7 处理校验、冲突和 I/O 错误，成功后重新扫描并展示“下一次 assistant turn 生效”反馈，避免修改任何活动 catalog。
- [x] 4.8 增加 command controller 测试，覆盖所有范围、显式动作行、Enter 确认、字符键无副作用、Esc 层级、冲突保留草稿和无效文件限制。

## 5. Surface 渲染与终端体验

- [x] 5.1 实现 Agents 列表 surface，展示来源、active/shadowed/invalid/reserved 状态、capability、模型、effort、工具、MCP 和有界诊断。
- [x] 5.2 实现详情、字段表单、工具多选、instructions composer 和确认 surface，复用现有主题、focus bar、窗口裁剪与真实光标策略。
- [x] 5.3 针对窄终端和受限行数实现稳定裁剪，保证当前选项、错误、确认动作和操作提示可见，且不使用 alternate screen。
- [x] 5.4 增加 renderer 与 footer 测试，覆盖空状态、长文本、宽度变化、动作选中、默认取消、输入光标和来源覆盖提示。

## 6. 文档与验证

- [x] 6.1 更新 README，说明 `/agents`、manifest model/effort、内置 override、显式确认键位、覆盖/诊断和下一轮生效语义。
- [x] 6.2 更新 `docs/tui-architecture.md`，记录 Agent 管理端口/surface、物理目录视图、settings sidecar、严格模型解析和冻结边界。
- [x] 6.3 运行 `npm run typecheck` 并修复全部类型错误。
- [x] 6.4 运行 `npm test` 并修复全部自动化测试失败。
- [x] 6.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 并确认脚本语法检查通过。
- [x] 6.6 由用户手动验证 `/agents` 的列表、创建/编辑、工具与 instructions 输入、Enter 确认、默认取消、删除覆盖提示、模型生效、resize 和退出清理。
