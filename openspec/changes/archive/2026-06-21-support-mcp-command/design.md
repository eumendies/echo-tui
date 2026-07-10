## Context

当前 MCP runtime 已支持从 `~/.echo/config.json` 读取 `mcp.enabled` 与 `mcp.servers`，在 TUI 启动后异步初始化 enabled servers，并将成功初始化的 tools 暴露给后续 provider request。现有 `/skills` 已经提供了一个成熟的本地 command pattern：handler 读取领域状态、打开 command session、renderer 投影 transient surface、Space 修改草稿、Enter 通过 `CommandHost` 保存、Esc 取消。

`/mcp` 的目标与 `/skills` 交互相似，但状态边界更复杂：MCP enabled 状态是 `config.json` 的一部分，保存后还涉及已连接 MCP clients 的关闭、重新初始化、tool registry 更新和诊断展示。因此该设计需要同时触达配置读写、MCP manager lifecycle、CommandHost facade、slash command handler 和 footer surface。

## Goals / Non-Goals

**Goals:**

- 提供 `/mcp` command，让用户在 TUI 内查看和启停 MCP 全局开关及各 server。
- 保存到 `~/.echo/config.json`，保持 MCP 配置只有一个事实来源。
- 保存后重载 MCP manager，使下一轮 assistant request 立即使用最新 MCP tools。
- 沿用现有 command session/surface 架构，不让 handler 直接访问完整 `AppContext`、renderer 或 terminal。
- 保留用户配置中的未知字段和 server 细节，仅修改 enabled 字段。

**Non-Goals:**

- 不在第一版中新增、删除 MCP server。
- 不在第一版中编辑 `command`、`url`、`args`、`env`、`headers`、`approval`、`timeoutMs` 等 server 配置字段。
- 不支持 MCP tool 级别启停；启停粒度为全局 MCP 和 server。
- 不做增量 reload 优化；第一版可以采用关闭所有 active clients 后按最新配置重新 bootstrap 的简单策略。

## Decisions

### 1. `/mcp` 直接写回 `~/.echo/config.json`

MCP enabled 状态已经存在于 `mcp.enabled` 和 `mcp.servers.<name>.enabled`。如果额外引入类似 skills 的独立 disabled-state 文件，会让配置文件和状态文件同时决定 MCP 行为，造成事实来源冲突。因此 `/mcp` 保存 SHALL 直接更新用户配置中的 enabled 字段，并保留其它字段。

替代方案是创建 `mcp-state.json`，优点是实现与 `/skills` 更接近；缺点是用户手动编辑 config 后难以判断最终状态，且 `readMcpConfig()` 必须合并两套状态，复杂度不值得。

### 2. 区分 runtime config 读取和 UI draft 读取

现有 MCP runtime 读取函数会过滤 disabled server，只返回需要初始化的 server。`/mcp` 需要展示 disabled、invalid 和全局 disabled 状态，因此需要新增面向 UI 的 draft/list 读取能力。该能力 SHALL 从 raw config 构造 command 所需的 server info，保留无效 server 的名称、enabled 草稿值和诊断摘要。

### 3. 通过 `CommandHost.mcp` 暴露受控领域能力

`/mcp` handler 不直接读取 config 文件、不直接操作 `McpManager`，而是通过 `CommandHost` 的 MCP facade 获取列表和保存状态。这样符合现有 command-host-runtime 约束：新增命令的业务能力由 host 控制，command runtime 只管理 session 和事件分发。

### 4. 保存后执行 MCP manager reload

保存配置后仅提示“重启生效”虽然实现简单，但与 `/skills` 的即时生效体验不一致，也无法释放被禁用 stdio server 的进程。第一版 SHALL 支持 runtime reload：保存配置后关闭当前 active MCP clients，清空 tool registry 状态，再按最新配置重新 bootstrap。下一轮 assistant request 使用 `McpManager.listTools()` 读取当前 server map，因此无需重建 agent runtime。

### 5. 使用独立 MCP surface，不复用 Skills surface 类型

`/skills` surface 字段包含 `sourceKind`、`description` 等 skill 语义；MCP 需要展示 global row、transport、tool count、valid/invalid、diagnostic 等信息。新增 `McpCommandSurface` 可以保持类型语义清晰，同时视觉风格复用 `/skills` 的 neon card、on/off pill、selected accent 和计数。

## Risks / Trade-offs

- [Risk] reload 期间关闭并重启所有 active MCP servers 可能比增量更新慢 → Mitigation：`/mcp` 保存是低频手动操作，第一版优先简单正确；后续可按 server config fingerprint 做增量 reload。
- [Risk] 保存 config 时破坏用户未知字段或格式 → Mitigation：读取 root object 后只修改 enabled 字段，并使用原子写 temp + rename；不重新生成 server 子配置。
- [Risk] 无效 server 被用户切为 enabled 后 reload 出现失败 → Mitigation：`/mcp` 面板显示 invalid 诊断；保存后 reload diagnostics 以 transient UI 或 command surface 结果反馈。
- [Risk] reload 与正在进行的 assistant/tool call 并发 → Mitigation：`/mcp` 作为 command session 只在普通输入态启动；保存时若 app 正在 responding 则不会进入 command 提交路径，后续实现中保持现有 response lock 约束。
- [Risk] 全局 `mcp.enabled=false` 时 server 行状态含义不直观 → Mitigation：面板包含 global MCP row，明确全局关闭会使所有 server 不初始化；server enabled 草稿仍保留为配置意图。

## Migration Plan

该变更不需要用户迁移。已有 `~/.echo/config.json` 的 MCP 配置继续兼容；新增 `/mcp` 只修改既有 enabled 字段。若用户不使用 `/mcp`，启动和 tool 暴露行为保持现状。

回滚时删除 `/mcp` command、surface、host MCP facade 和 manager reload 入口即可；已有 config 中的 enabled 字段仍是当前 MCP runtime 支持的字段，不会造成配置不兼容。

## Open Questions

- 第一版保存成功后的反馈采用关闭面板并展示 local notice，还是保持 transient info surface 展示 reload 结果；实现时应优先复用现有 transient command surface，不污染 transcript。
- 全量 reload 后是否需要保留旧 diagnostics 直到下一次启动；倾向于 diagnostics 始终反映最近一次 bootstrap/reload 结果。
