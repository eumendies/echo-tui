## Why

echo-tui 的 MCP 集成目前只覆盖 tools：server 通过 `resources/list` 暴露的资源、`resources/read` 返回的内容、resource templates 都拿不到，tool result 里的 `resource_link` 也只被投影成一行文本。这等于把 server 的只读能力砍掉一半。主流客户端已普遍支持资源读取（Codex CLI 三个合成工具、Gemini CLI `list_mcp_resources`/`read_mcp_resource` 加 `@` 提及、Crush 两个合成工具、Claude Code 合成工具加 `@` 提及），且读取普遍免确认（Gemini 文档明确 Confirmation: No，Claude Code 两个内置资源工具标注 Permission required: No）。echo-tui 侧没有任何资源读取路径，需要补齐。

## What Changes

- MCP client 增加 resources 能力：按 server capability 门控的 `listResources`（分页、有界）、`listResourceTemplates`、`readResource`；server 不支持（`-32601`）或未声明 resources capability 时降级为空目录并记录诊断，不视为启动失败。
- MCP manager 在 bootstrap/reload 时拉取并缓存每 server 的资源目录与模板（条数与描述长度有界），并暴露 `listResources()` / `readResource(server, uri)`；诊断继续脱敏。
- 新增两个内置工具（全局，不按 server 命名空间展开）：`list_mcp_resources`（可按 server 过滤，输出包含 resource templates）与 `read_mcp_resource`（server + uri）。
- 只读放行：两个工具按只读观察工具分类，不进入审批（与 `read_files`/`web_fetch` 同级），不改变既有 MCP tool 的只读注解审批语义。
- 结果边界：文本结果复用既有 tool-result offloading（MCP 级 20,000 bytes 上限加 marker 落盘）；`blob` 投影为 `[Binary resource content <mime>, N bytes]` 占位符，不做 base64 内联。
- 边界放行：plan 模式放行资源读取；BTW 与 `/review` 只读运行把它加入只读观察集合；explorer 与自定义 readonly 子 Agent 可通过能力上限声明获得资源读取（readonly 依旧不能启用 MCP tools）；headless `--once` 免 `--full-access`。
- provider 可见 schema 与执行 registry 在 run 启动时冻结，与工具目录同源，运行中不重新拉取。
- 非目标：`@` 提及或资源选择器 UI、`/mcp` 面板资源清单、`resources/subscribe` 与 `resources/updated`、`notifications/*/list_changed` 自动刷新、MCP prompts。

## Capabilities

### New Capabilities

- `mcp-resource-access`: MCP 资源发现（capability 门控、分页、有界缓存）、两个内置读取工具的参数与输出契约、只读放行与边界放行（plan / readonly run / explorer / headless）、结果预算与 blob 投影。

### Modified Capabilities

- `local-tool-execution`: 只读策略允许集合与工具并发分类新增两个资源读取工具（分类为 `parallel_read`）。
- `readonly-subagent-delegation`: explorer 专属 registry 与「保持严格只读策略」的要求扩展为「可读 MCP 资源、仍禁用 MCP tools」。
- `general-purpose-worker-subagent`: Worker 工具面新增资源读取工具，Explorer 与 Worker 的区分按「MCP tools 禁用 / 资源读取可用」重述。
- `custom-subagent-definitions`: readonly 与 general 能力上限新增两个工具名；readonly 仍强制不启用 MCP tools。
- `app-mode-command`: plan 模式边界明确放行资源读取工具。
- `bounded-tool-results`: 明确 MCP 来源的资源读取结果适用 MCP 级 20,000 bytes 预算。

## Impact

- 代码：`src/mcp/client.ts`（capability 门控与资源 API）、`src/mcp/manager.ts`（目录缓存与读取代理）、新增 `src/tools/mcp-resource-tools.ts`、`src/tools/tool-registry.ts`（注册与 registry 选项）、`src/agent/agent-setup.ts`（registry 装配与 MCP tools 合并解耦）、`src/agent/loop-runtime/subagent-loop-runtime.ts`（向 prepareAgent 传共享 manager）、`src/agent/subagent/definition.ts`（只读与通用工具上限）、`src/tools/tool-risk-classifier.ts`（只读观察集合并发放行）。
- 配置：无新增用户配置字段，不重新引入 server 级开关。
- 测试：`test/mcp/manager.test.js`、新增 `test/tools/mcp-resource-tools.test.js`、`test/tools/tool-risk-classifier.test.js`、`test/tools/tool-concurrency-classifier.test.js`、`test/agent/agent-loop-runtime.test.js`、`test/agent/subagent-runtime.test.js`。
- 文档：`README.md`、`src/skills/builtin/echo-tui-setup/SKILL.md`、`docs/tui-architecture.md`。
- 已知缺口（本变更范围之外）：上一处改动（MCP 审批改由只读注解决定并删除 server 级 `approval`）未同步 openspec，`mcp-tool-integration` 仍描述 server 级审批策略；建议随后单独补一个 delta。
