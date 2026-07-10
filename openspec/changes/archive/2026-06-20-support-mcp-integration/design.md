## Context

echo_tui 当前通过内置 `ToolRegistry` 把本地工具定义提供给 OpenAI Responses、OpenAI Chat 和 Anthropic provider，并通过统一 `ToolExecutor` 执行 tool call。工具集合在 agent run state 初始化时生成，provider adapters 只消费 provider-neutral `ToolDefinition`。

MCP 接入需要引入外部 tool catalog 和外部 tool execution 边界。用户明确倾向于：TUI 启动后先进行 MCP 初始化，初始化完成前不允许提交问答；单个 MCP server 初始化失败时展示错误，但不把该 server 的 tools 注册到 registry，后续普通问答仍可继续。

## Goals / Non-Goals

**Goals:**

- 使用官方 MCP SDK 接入 MCP client 能力。
- 第一版同时支持 `stdio` 和 `http` transport。
- 从用户级配置读取 MCP servers，并在 TUI 启动后统一 bootstrap。
- 初始化完成前阻止问答提交，但保持 TUI 可见、可退出和可 resize。
- 成功初始化的 MCP server 将 tools 转成 echo_tui 现有 `ToolDefinition` / `ToolHandler`。
- 失败 server 只产生可见诊断，不注册 tools，也不阻止普通问答。
- MCP tools 默认需要用户审批；显式配置可跳过审批。
- plan mode 默认不暴露 MCP tools。

**Non-Goals:**

- 不实现 MCP resources、prompts、sampling 或 server-to-client elicitation。
- 不实现 echo_tui 作为 MCP server 被其他客户端调用。
- 不实现 `/mcp` 管理命令、热 reload 或 server 状态面板。
- 不实现 SSE legacy transport；第一版 HTTP 指官方 SDK 当前推荐的 HTTP MCP transport。
- 不实现 MCP tool include/exclude 白名单；第一版按 server 暴露其初始化时返回的全部 tools。
- 不在第一版为 MCP rich content 做专用 transcript 渲染，先转换为文本 tool result。

## Decisions

### 1. MCP 作为 ToolRegistry 扩展，而不是 provider adapter 特例

MCP tools 会被适配为现有 `ToolDefinition` 和 `ToolHandler`，并与内置工具 registry 合并。OpenAI/Anthropic adapters 继续使用当前 tool converter，不直接感知 MCP 协议。

替代方案是让 provider adapter 直接理解 MCP 或提供一个通用 `mcp_call` tool。前者会在每个 provider 中重复 MCP 逻辑；后者会丢失 MCP tool 的真实 schema，降低模型参数生成质量。因此选择 registry adapter。

### 2. 启动期统一初始化 MCP servers

TUI `start()` 后进入 MCP initializing 状态，异步初始化所有 enabled MCP servers。初始化期间允许输入编辑、退出和 resize，但提交、slash command 启动和 mode 切换被 gate。初始化完成后进入 ready 状态。

替代方案是在每轮 agent 请求前初始化。该方案会让用户每轮等待 MCP discovery，并使 provider-visible tool catalog 随请求抖动。启动期初始化能保持 tool catalog 稳定，也更容易表达失败诊断。

### 3. 单个 server 失败时降级，而不是阻断整个 app

MCP server 初始化失败只影响该 server：记录诊断、不注册 tools、继续初始化其他 server。初始化全部结束后，如果存在失败 server，TUI 展示 transient 诊断；用户关闭诊断后正常问答。所有 MCP server 都失败时，仍允许普通问答。

配置结构错误也按 server 维度处理，除非根配置无法读取或 LLM 配置本身不可用。这样 MCP 作为增强能力不会破坏基础问答。

### 4. 支持 stdio 与 http transport

第一版配置支持：

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": {
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
        "approval": "always"
      },
      "docs": {
        "transport": "http",
        "url": "https://docs.example.com/mcp",
        "headers": {"Authorization": "Bearer token"},
        "approval": "never"
      }
    }
  }
}
```

`stdio` 适合本地 server，`http` 适合远端/托管 server。两者在 MCP manager 内部统一成 `listTools` 和 `callTool` 能力。

### 5. MCP tool 名称使用 namespace

MCP tools 暴露给 provider 时命名为：

```text
mcp__<serverName>__<toolName>
```

serverName 和 toolName 会归一化为 provider tool name 可接受的字符集合。执行时根据该名称反查原始 server/tool。

这样可以避免多个 MCP server 中的 `search`、`read_file` 等工具重名。

### 6. MCP tools 默认审批

MCP server 可能代表远端服务或有副作用的本地能力，因此默认 `approval: "always"`。配置显式 `approval: "never"` 时，该 server 的 MCP tools 才跳过审批。

审批 preview 使用 MCP server 名、原始 tool 名和参数摘要，而不是展示内部 namespace 噪音。拒绝时复用现有 tool result continuation 语义。

### 7. plan mode 默认不暴露 MCP tools

当前 plan mode 只允许只读观察和受限 bash inspection。MCP server 的真实副作用无法仅通过 tool 名称可靠判断，因此第一版 plan mode 不合并 MCP registry。

后续可以增加 `availableInPlan` 和只读 MCP server 白名单，但不在本次范围内。

### 8. MCP diagnostics 不写入 transcript

启动期 MCP 失败诊断是 app runtime 状态，不是对话事实。第一版应通过 transient info surface 或等价 footer surface 展示，不追加 transcript record，也不进入 session persistence。

如果实现成本过高，可先用 transient command/info surface 复用现有 render 能力，但不得伪装为 user/assistant 消息。

## Risks / Trade-offs

- [Risk] MCP SDK 的 HTTP transport API 与 CommonJS 编译产物兼容性不确定 → 在实现前用最小编译 spike 验证，并把 SDK 使用封装在 `src/mcp/` 内部。
- [Risk] 启动期初始化慢会影响首屏可用性 → TUI 先渲染，再显示 initializing 状态；每个 server 使用 timeout，失败降级。
- [Risk] MCP tool catalog 很大导致 provider tool tokens 膨胀 → `/context` 会显示 Tools 占用；tool include/exclude 留作后续优化。
- [Risk] HTTP MCP headers/token 出现在错误信息中 → 错误诊断必须脱敏 headers 和常见 token 形态。
- [Risk] 远端 MCP tool result 可能包含 prompt injection → 默认审批只能控制调用前风险；结果仍作为 tool output 回传给模型，后续可增加信任提示或 server 分级。
- [Risk] stdio server 子进程生命周期泄漏 → McpManager 持有 server client/transport，并在 app exit 时关闭所有已启动 server。
- [Risk] 初始化期间输入 gate 与现有 responding lock 混淆 → 使用独立 app readiness/MCP bootstrap 状态，不复用 assistant `responding`。

## Migration Plan

1. 新增 MCP 配置解析，缺省 `mcp.enabled = true`、空 servers 时行为与现在一致。
2. 引入 MCP manager/client/registry adapter，但未配置 MCP 时不改变现有工具集合。
3. 在 app start 后执行 MCP bootstrap；无 MCP server 时立即 ready。
4. 将成功初始化的 MCP registry 注入 agent loop 的 registry 创建路径。
5. 更新风险分类和 approval preview。
6. 添加配置、bootstrap、tool adapter、失败降级和 UI gate 测试。

Rollback 策略：删除或关闭配置中的 `mcp.servers` 即可恢复到仅内置工具；如果 SDK 或 bootstrap 出现问题，可通过 `mcp.enabled: false` 禁用 MCP。

## Open Questions

- HTTP transport 是否需要同时兼容 SSE legacy，还是仅支持官方 SDK 当前推荐的 HTTP MCP transport？当前设计选择后者。
- 是否要在第一版支持 `${ENV_VAR}` 形式的 header/env 插值？当前设计暂不要求，沿用明文 config 字符串。
- 失败诊断 surface 是否需要可再次查看？当前设计只要求启动后 transient 展示，未来可通过 `/mcp` 命令扩展。
