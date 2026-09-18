## 1. MCP client 资源能力

- [x] 1.1 `src/mcp/client.ts`：为 `EchoMcpClient` 增加 capability 判定（server 是否声明 `resources`）与窄投影类型（资源、模板、读取结果）
- [x] 1.2 `src/mcp/client.ts`：实现 `listResources` 与 `listResourceTemplates`，跟随分页游标但受页数上限约束
- [x] 1.3 `src/mcp/client.ts`：实现 `readResource`，把 contents 投影为 text 或 blob 加 mimeType

## 2. Manager 目录缓存与读取代理

- [x] 2.1 `src/mcp/manager.ts`：bootstrap/reload 时按 capability 拉取资源与模板；未声明不调用，`-32601` 或其它失败降级为空目录并写脱敏诊断
- [x] 2.2 `src/mcp/manager.ts`：对条目数与描述长度设上限，缓存随 reload 更新、随 close 清理
- [x] 2.3 `src/mcp/manager.ts`：暴露 `listResources()` 与 `readResource(serverName, uri)`，未知 server 返回明确错误且不新建连接

## 3. 资源读取工具

- [x] 3.1 新增 `src/tools/mcp-resource-tools.ts`：导出两个工具名常量与 handler 工厂
- [x] 3.2 `list_mcp_resources`：支持可选 server 过滤，输出资源与 resource templates，空目录给出可执行提示
- [x] 3.3 `read_mcp_resource`：按序合并多条 contents，blob 投影为二进制占位符，文本走 20,000 bytes 预算与既有 offloading
- [x] 3.4 错误路径：未知 server、uri 不存在与 server 异常返回有界失败结果并经 `sanitizeMcpError` 脱敏

## 4. 注册与接线

- [x] 4.1 `src/tools/tool-registry.ts`：`DefaultToolRegistryOptions` 增加可选 `McpManager` 并注册资源工具，仍受 `allowedToolNames` 过滤
- [x] 4.2 `src/agent/agent-setup.ts`：`PrepareAgentOptions` 增加 `includeMcpTools`（缺省 true），把 MCP tools 合并与资源工具注册解耦
- [x] 4.3 `src/agent/loop-runtime/subagent-loop-runtime.ts`：向 `prepareAgent` 传共享 manager 并用 `definition.includeMcpTools` 控制 MCP tools
- [x] 4.4 确认主 runtime 与 headless `--once` 路径获得资源工具，且 provider schema 与执行 registry 同源冻结

## 5. 子 Agent 能力上限

- [x] 5.1 `src/agent/subagent/definition.ts`：只读与通用工具上限加入两个工具名，explorer 与 worker 默认包含
- [x] 5.2 `src/agent/subagent/catalog.ts`：确认 readonly 定义仍拒绝 `mcp: true`，资源工具不被解释为该字段的用途
- [x] 5.3 explorer prompt 明确「资源读取可用、`mcp__` 工具仍禁用」

## 6. 风险分类与边界

- [x] 6.1 `src/tools/tool-risk-classifier.ts`：两个资源工具在 `classifyToolCallRisk` 早返回 `safe`，早于 plan 与 MCP 分支
- [x] 6.2 `src/tools/tool-risk-classifier.ts`：把两个工具加入只读观察集合，供只读运行与只读子 Agent 放行
- [x] 6.3 确认并发分类把它们判为 `parallel_read`，且不改变 MCP tools 的只读注解审批语义
- [x] 6.4 确认 headless 默认 deny 策略下资源读取直接执行、无需 `--full-access`

## 7. 测试

- [x] 7.1 `test/mcp/manager.test.js`：capability 门控、method not found 降级、分页与上限、读取代理与未知 server 错误
- [x] 7.2 新增 `test/tools/mcp-resource-tools.test.js`：列表与过滤、读取合并、blob 占位符、超限 marker 与错误脱敏
- [x] 7.3 `test/tools/tool-risk-classifier.test.js`：normal 安全、plan 放行、只读运行放行，MCP tools 边界不变
- [x] 7.4 `test/tools/tool-concurrency-classifier.test.js`：资源读取为 `parallel_read`
- [x] 7.5 `test/agent/agent-loop-runtime.test.js`：只读运行与 plan 模式端到端放行且不请求审批
- [x] 7.6 `test/agent/subagent-runtime.test.js`：explorer 具备资源工具但无 `mcp__` 工具；自定义 readonly 默认不含资源工具

## 8. 文档

- [x] 8.1 `README.md`：MCP 段落说明资源读取工具与只读放行语义
- [x] 8.2 `src/skills/builtin/echo-tui-setup/SKILL.md`：补充资源能力说明与工具名
- [x] 8.3 `docs/tui-architecture.md`：MCP manager、工具注册、分类器与子 Agent 相关表格行同步

## 9. 校验

- [x] 9.1 `npm run typecheck`
- [x] 9.2 `npm test`
- [x] 9.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 9.4 `openspec validate` 通过本变更
