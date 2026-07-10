## 1. 工具实现

- [x] 1.1 新增 `src/tools/glob-tool-handler.ts`，实现 strict function schema、参数校验、cwd/path 解析、NUL 与 `.git` 拒绝语义。
- [x] 1.2 使用 `spawn` 参数数组调用 `rg --files --hidden --sort path --null`，解析 NUL 分隔输出，并对返回路径再次过滤 `.git` 内部路径。
- [x] 1.3 实现结果格式化：包含 `glob:` envelope、pattern、paths、returned_paths、has_more、路径列表、截断提示和失败原因。
- [x] 1.4 将 `glob` handler 接入 `createDefaultToolRegistry`，并导出 `GLOB_TOOL_NAME` 与 `DEFAULT_MAX_PATHS` 供测试使用。
- [x] 1.5 更新内置 system prompt，引导模型按文件名或路径模式发现文件时优先使用 `glob`。

## 2. 测试覆盖

- [x] 2.1 扩展默认 tool registry 测试，确认 `glob` 默认暴露且顺序符合预期。
- [x] 2.2 添加 `glob` schema 测试，确认 strict required 字段和 nullable `paths` 契约。
- [x] 2.3 添加成功路径测试：默认 cwd 搜索、限定 `paths`、排序输出、hidden 文件发现、无匹配成功。
- [x] 2.4 添加安全和失败测试：非法 pattern、非法 paths、NUL、`.git` 输入拒绝、`.git` 输出过滤、ripgrep 缺失或运行错误。
- [x] 2.5 添加截断测试，确认超过 `DEFAULT_MAX_PATHS` 时 `truncated: true`、`has_more: true` 且提示收窄查询。

## 3. 文档与验证

- [x] 3.1 更新 `docs/tui-architecture.md` 的本地工具说明，记录 `glob` 的定位、输入、输出和底层执行策略。
- [x] 3.2 运行 OpenSpec 校验或状态检查，确认 `add-glob-tool` artifacts 可被识别为 apply-ready。
- [x] 3.3 运行 `npm run typecheck`。
- [x] 3.4 运行 `npm test`。
- [x] 3.5 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
