## Context

echo-tui 的 MCP 层目前只有 tools：`src/mcp/client.ts` 的 `EchoMcpClient` 只投影 `listTools`/`callTool`，`src/mcp/manager.ts` 在 bootstrap 时只拉取工具目录，`src/mcp/tool-adapter.ts` 把工具适配进 registry。结果格式化里遇到 tool result 的 `resource_link` 或内联 `resource` 内容块时只做文本投影，模型拿不到资源内容，也没有任何工具可以主动读取。

三个上游约束决定了设计空间：

1. MCP 规范中 `resources` capability 是独立且可选的（`subscribe`、`listChanged` 也是可选的），因此资源调用必须容忍 `-32601`（Codex 曾因把可选端点错误当作致命错误中断）。
2. 资源注解只有 `audience`/`priority`/`lastModified`，**没有只读类 hint**，所以"资源读取是否免审批"不能沿用 MCP tool 的 `readOnlyHint` 机制，必须作为本地策略显式决定。
3. 调研到的客户端里，资源读取入口以"合成工具"为主流（Codex CLI 三工具、Gemini CLI 两工具、Crush 两工具、Roo 单工具 `access_mcp_resource`），`@` 提及是第二形态（Claude Code、Gemini），只有 UI 浏览等于没有 agent 侧能力；读取审批普遍放宽（Gemini 文档 Confirmation: No、Claude Code 内置资源工具 Permission required: No）。

## Goals / Non-Goals

**Goals:**

- 让 agent 能发现并读取 server 暴露的 resources 与 resource templates，且不引入新的用户配置字段。
- 复用既有机制：tool registry、tool-result offloading、transcript、子 Agent 白名单、plan/readonly/headless 策略，不新增平行执行通道。
- 明确并统一资源读取在三类边界上的语义：plan 模式、只读运行（BTW/`/review`）、子 Agent（explorer/worker/custom）。

**Non-Goals:**

- 不做 `@` 提及 / 资源选择器 UI、不在 `/mcp` 面板展示资源清单（后续迭代）。
- 不做 `resources/subscribe`、`resources/updated` 与 `notifications/*/list_changed` 自动刷新。
- 不做 MCP prompts、sampling、elicitation、roots。
- 不重新引入 server 级审批开关。

## Decisions

### D1: 资源以两个全局内置工具暴露，而不是 per-server 命名空间工具

新增 `list_mcp_resources`（可选 `server` 过滤，输出同时包含 resource templates）与 `read_mcp_resource`（`server` + `uri`）。工具名与 Codex/Gemini/Crush 对齐，便于模型迁移既有习惯。

- 备选 A：`mcp__<server>__read_resource` 形式的命名空间工具。被否：工具数量随 server 数线性增长（N×2），直接挤压 provider schema 预算，而资源读取本身是低频操作。
- 备选 B：把资源目录注入 system context，靠模型直接引用。被否：结论是同一次迭代内不引入上下文预算与失效策略的复杂度（阶段 2 再评估）。
- 备选 C：`@` 提及注入。被否（本迭代）：只解决"用户挑资源"，不解决"agent 自主读取"，且需要新的 UI surface。

### D2: 调用按 server capability 门控，失败降级为空目录

bootstrap 时读取 server 声明的 capabilities；未声明 `resources` 的 server 不发起资源请求。声明了但调用返回 `-32601`（协议层不支持）或其它错误时，该 server 的资源目录降级为空并写入既有脱敏诊断，**不影响** server 的工具能力与连接状态。

- 理由：资源是可选特性，把可选端点的失败升级为 server 初始化失败会直接砍掉工具能力（上游已发生过此类回归）。

### D3: 目录在 manager 内缓存且有界，run 启动时冻结

`listResources` 跟随分页游标但设置页数与条目上限；每 server 的资源条数与描述长度截断；模板同理。缓存只在 bootstrap/reload 时更新，run 内不重新拉取，工具装配与既有的只读工具名称集合、registry 一样在 run 启动时同源冻结。

- 理由：避免 server 用无限分页或超长描述拖慢启动或撑爆 schema；与既有"运行中不重读目录"的纪律一致。

### D4: 资源读取按只读观察工具放行，不进入审批

两个工具在风险分类的最前面直接判定 `safe`（早于 plan 分支与 MCP 分支），并加入共享的只读观察工具集合，因此：normal 与 plan 模式直接执行；BTW 与 `/review` 只读运行放行；headless `--once` 无需 `--full-access`；并发分类为 `parallel_read`。

- 理由：读取资源与 `read_files`/`web_fetch` 同级，都是纯观察；上游主流同样不做逐次确认。引入审批会让多步检索（先列表再逐个读取）退化成 N 次人工交互。
- 备选：逐次审批（Roo 风格 `access_mcp_resource` + `alwaysAllowMcp`）。被否：与"删掉 server 级审批开关"的方向相反，且上游已证明没必要。
- 边界：MCP *tools* 的审批仍由 `readOnlyHint` 决定，两套语义互不影响（资源工具不带 `mcp__` 前缀，不会落入 MCP 分支）。

### D5: 资源工具注册进默认 registry，靠 `allowedToolNames` 做子 Agent 收窄

`createDefaultToolRegistry` 接受可选的 `McpManager` 并注册两个资源工具；子 Agent 仍通过定义白名单（`allowedToolNames`）在 provider schema 与执行器两侧同时收窄。相应地 `prepareAgent` 的 MCP 工具合并与资源工具注册解耦：新增 `includeMcpTools?: boolean`（缺省 true）单独控制 MCP *tools* 的合并，子 runtime 可只传 manager 而不启用 MCP tools。

- 理由：复用既有"定义白名单两侧生效"的纪律，避免为资源单独发明一套子 Agent 可见性判断。
- 备选：新建 `createMcpResourceToolRegistry` + `mergeToolRegistries`。被否：合并发生在 `allowedToolNames` 过滤之后，会绕过白名单，需要额外的子 Agent 分支判断。

### D6: explorer 与自定义 readonly 通过能力上限获得资源读取

只读与通用子 Agent 工具上限新增两个工具名（explorer 默认包含；自定义 readonly 定义需显式声明）。`mcp` manifest 字段语义不变，仍只控制 MCP *tools*，readonly 定义依旧不允许 `mcp: true`。

- 理由：资源读取是只读能力，不违反 readonly 的能力收窄意图；显式声明保持"自定义定义只能收窄、不能扩权"的边界。
- 风险与控制：explorer prompt 与文档明确"MCP tools 仍禁用，仅资源读取可用"，避免把该变化误读为 MCP 全面放开。

### D7: 结果预算沿用 MCP 级 20,000 bytes，blob 只给占位符

文本内容复用 `createOffloadedTextPreview`（head + 截断 marker + artifact 落盘），上限与 MCP tool 结果一致；`blob` 不内联 base64，投影为 `[Binary resource content <mime>, N bytes]`。

- 理由：资源内容与 MCP tool 内容同属远端来源，预算口径应一致（现规范按"除 MCP 外的内置工具 65,536 / MCP 20,000"划分，本次需要把资源读取明确归入后者）。
- 备选：把 `image/*` 转成 tool result attachment。延后到后续迭代（现有 attachment 通道可直接复用）。

## Risks / Trade-offs

- [免审批读取可能读到敏感内容] → 与 `read_files`/`web_fetch` 采用同一信任模型（server 由用户配置并显式启用）；blob 不内联；错误文本继续走 `sanitizeMcpError` 脱敏。
- [server 用超长目录拖慢启动] → 分页页数、条目数、描述长度三重上限；资源拉取失败不影响工具能力。
- [explorer 获得资源读取被误读为 MCP 放开] → 文档、explorer prompt 与 spec 同时明确 tools 禁用与资源可读的分界；`includeMcpTools` 语义不变。
- [两个全局工具挤压 schema 预算] → 固定 2 个工具，不随 server 数增长；描述保持简短。
- [资源内容与本地文件混淆] → 资源 URI 只在工具参数与结果中出现，不映射为本地路径，也不参与 change history。
- [可选端点误判] → 未声明 capability 不得调用；`-32601` 只降级为空目录并记录诊断。

## Migration Plan

无配置迁移：不新增字段，也不重新引入审批开关。既有 MCP server 配置与工具行为保持不变；回滚只需移除两个工具注册、只读集合项与上限条目。

## Open Questions

- `/mcp` 面板是否展示资源数量与诊断（当前只展示 tool 数）——留给阶段 2。
- 是否把 `image/*` blob 映射为 attachment、是否支持 `resources/subscribe` 与 `list_changed` 失效刷新——留给阶段 2/3。
- system prompt 是否需要显式提示"tool result 中的 `resource_link` 可用 `read_mcp_resource` 解析"——本迭代先只写在工具描述里，观察模型使用情况再决定。
