## 1. Skill registry 与文件解析

- [x] 1.1 新增 skill 类型定义，覆盖 metadata、来源路径、加载结果和 catalog entry。
- [x] 1.2 实现项目级 `.echo/skills/<name>/SKILL.md` 与用户级 `~/.echo/skills/<name>/SKILL.md` 扫描。
- [x] 1.3 实现 `SKILL.md` 基础 frontmatter 解析，支持 `name` 与 `description` 字段。
- [x] 1.4 实现同名覆盖规则：项目级 skill 优先于用户级 skill，catalog 按名称稳定排序。
- [x] 1.5 为 skill discovery、无效文件跳过、同名覆盖和正文加载失败补充单元测试。

## 2. use_skill 本地工具

- [x] 2.1 新增 `use_skill` tool definition，参数为 `{ name: string, arguments?: string | null }`。
- [x] 2.2 实现 `use_skill` handler，按名称读取 skill 并返回包含名称、来源、参数和正文的 tool result。
- [x] 2.3 将 `use_skill` 注册到默认 tool registry，保持 provider-neutral executor 语义。
- [x] 2.4 为成功加载、未知 skill、无效参数和读取失败补充工具 handler 测试。
- [x] 2.5 验证 `use_skill` tool_call/tool_result 能按现有 converter 参与 agent continuation。

## 3. Provider catalog 注入

- [x] 3.1 扩展 provider records 构建路径，在存在 skill 时把短 catalog 拼入内置 system prompt。
- [x] 3.2 确保 catalog 只包含 skill 名称和描述，不包含完整 `SKILL.md` 正文。
- [x] 3.3 确保每次 agent run 基于当前文件系统 skill 状态生成或刷新 catalog。
- [x] 3.4 为有 skill、无 skill、catalog 不含正文和刷新行为补充 agent/system prompt 测试。

## 4. 使用记录与 slash 边界

- [x] 4.1 实现从 transcript 中识别 `use_skill` tool_call/tool_result 的使用记录辅助逻辑。
- [x] 4.2 确保默认 slash command handlers 和 suggestion descriptors 不新增 `/skill`。
- [x] 4.3 为 `use_skill` 使用记录识别、非 skill 工具过滤和默认无 `/skill` 命令补充测试。
- [x] 4.4 在实现中保留 slash skill 未来扩展边界：不得把用户 slash 调用伪造为模型 tool_call。

## 5. Compaction 与回归验证

- [x] 5.1 确认 `use_skill` 记录沿用普通 tool_call/tool_result 压缩边界保护，不新增特殊生命周期。
- [x] 5.2 为 skill tool result 位于活跃区间和被压缩区间的行为补充或更新压缩测试。
- [x] 5.3 更新必要的 fake/stub agent fixture，使测试能覆盖模型自动调用 `use_skill`。
- [x] 5.4 运行 `npm run typecheck` 并修复类型错误。
- [x] 5.5 运行 `npm test` 并修复失败测试。
- [x] 5.6 运行 `find bin src test -name '*.js' -exec node --check {} \;` 完成 JS 语法检查。
