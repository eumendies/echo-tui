## 1. 工具 handler 与 schema

- [x] 1.1 新增 `grep` tool handler 模块，导出工具名称、`DEFAULT_MAX_MATCHES` 和 `createGrepToolHandler()`。
- [x] 1.2 定义 OpenAI strict 兼容 schema：`pattern`、`paths`、`glob`、`literal`、`case_sensitive` 全部 required，其中可选字段允许 `null`。
- [x] 1.3 实现参数归一化：校验 `pattern`、`paths`、`glob`、`literal`、`case_sensitive`，并应用默认 fixed-string 搜索语义。
- [x] 1.4 实现路径解析和拒绝规则：相对路径按 cwd，允许绝对路径和 `..`，拒绝 NUL 与 `.git` 内部路径。

## 2. ripgrep 执行与结果格式

- [x] 2.1 使用 `child_process.spawn` 参数数组调用 `rg --json`，不通过 shell 拼接命令。
- [x] 2.2 根据输入构造 ripgrep 参数：fixed-string / regex、case sensitivity、paths 和单个 glob。
- [x] 2.3 解析 ripgrep JSON lines，提取 match 事件中的 path、line、column 和 line text。
- [x] 2.4 实现 `DEFAULT_MAX_MATCHES`：超过上限时停止收集、终止子进程，并在 result 中标记 `has_more` / `truncated`。
- [x] 2.5 区分 ripgrep exit code：0 为有匹配成功，1 为无匹配成功，2 或 spawn error 为工具失败。
- [x] 2.6 格式化结构化 result 文本，包含 pattern、paths、glob、literal、case_sensitive、returned_matches、has_more 和 per-match envelope。

## 3. 注册与 agent 集成

- [x] 3.1 将 `grep` 注册到默认 tool registry，保持自定义 registry 行为不变。
- [x] 3.2 更新默认工具列表和 OpenAI request/tool conversion 相关测试预期。
- [x] 3.3 更新内置 system prompt，明确 `grep` 用于常规文本搜索，bash 用于复杂 shell、列目录、验证和特殊命令。
- [x] 3.4 确认 `ToolExecutionResult`、transcript persistence 和 agent loop continuation 不需要 schema 变更。

## 4. 测试与文档

- [x] 4.1 增加工具执行测试：固定字符串搜索、regex 搜索、paths/glob 限定、大小写设置和无匹配 ok true。
- [x] 4.2 增加错误/边界测试：无效参数、NUL、`.git`、regex 错误、ripgrep 缺失/运行错误和 `DEFAULT_MAX_MATCHES` 截断。
- [x] 4.3 更新本地工具相关文档或架构说明，说明 `grep` 与 `read_files` / `apply_patch` / bash 的职责边界。
- [x] 4.4 按仓库要求运行 `npm run typecheck`、`npm test`、`find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.5 运行 `npx -y @fission-ai/openspec@latest validate --all --strict`，确认 change 和主规格有效。
