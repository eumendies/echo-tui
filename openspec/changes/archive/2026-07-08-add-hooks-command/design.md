## Context

项目已有 lifecycle hooks 运行时能力：启动时从 `~/.echo/config.json#hooks` 读取配置，assistant/tool/compaction 事件通过 dispatcher 旁路派发，本地 hook 以非交互子进程执行，结果不进入 transcript、session 或模型上下文。当前缺口在于用户只能手写 JSON，配置是否生效、某条命令能否执行、保存后何时生效都缺少 TUI 内反馈。

`/hooks` 属于管理型 slash command，形态接近 `/mcp` 和 `/skills`，但风险边界更接近 hooks runtime：它可以读写用户级配置和执行本地命令测试，但不得让 hook 测试或 hook 运行结果影响 assistant turn、tool approval、tool execution、compaction 或 transcript。

## Goals / Non-Goals

**Goals:**

- 提供 `/hooks` command surface，用于按 lifecycle event 管理 hook entries。
- 支持添加、编辑 command、编辑 timeout、启用/停用、删除、保存和取消。
- 保存后在当前 TUI 进程中即时 reload hooks 配置，避免要求用户重启。
- 支持对单条 hook entry 执行 synthetic test，验证 hook 命令是否符合 stdin/env/cwd/timeout 执行契约。
- 测试模式可展示 bounded stdout/stderr、exit code、timeout 和耗时，但不写 transcript、不持久化、不回传模型。
- 保持 CommandHost 受控 facade：command handler 不直接读取配置文件、不直接访问 dispatcher 或完整 AppContext。

**Non-Goals:**

- 不在 `/hooks` 面板内展示完整配置示例或完整 payload 文档；这些内容放在 README/docs。
- 不实现真实 lifecycle event 的触发测试；测试不应发起 assistant 请求、执行真实 tool call 或执行 compaction。
- 第一版不实现最近真实 payload replay 或用户自定义 JSON payload 文件。
- 不改变 lifecycle hooks 的旁路观察者语义；hook 仍不能拦截、修改或拒绝主流程。
- 不引入第三方 TUI、JSON editor 或 shell command parser 依赖。

## Decisions

### 1. `/hooks` 使用专用 command surface，而不是通用 info/select 组合

`/hooks` 需要在事件列表、entry 列表、编辑态和测试结果之间切换，并展示启停状态、timeout、顺序和保存状态。使用专用 surface 可以让 renderer 只投影状态快照，handler 负责状态转换，保持和 `/mcp`、`/skills` 一致的 app 架构。

替代方案是用多个通用 `select`/`info` surface 串联，但这会让编辑态和测试结果散落在 handler 内部字符串里，难以测试，也难以保持键盘提示一致。

### 2. 通过 `CommandHost.hooks` 暴露受控能力

新增 host 领域接口，例如：

```text
hooks.readDraft()
hooks.saveDraft(draft)
hooks.testEntry(input)
hooks.createSyntheticPayload(event)
```

handler 只处理 command session 草稿和输入事件，不直接调用 `fs`、`readLifecycleHookConfig` 或 dispatcher。这样符合现有 command-host-runtime 约束，也便于测试 handler。

### 3. 配置草稿与 runtime config 分离

runtime config 只需要 enabled hooks；管理界面需要保留 disabled、invalid 和原始顺序。新增 hooks config editor 读取 `~/.echo/config.json` 为 draft：

- 有效 string shorthand 转为 enabled entry。
- 有效 object entry 保留 command、timeoutMs 和 enabled 状态。
- 无效或未知 event entry 以 diagnostic 展示，但不参与运行。
- 保存时只替换 `hooks` 节点，保留 root config 其它节点。

runtime `parseLifecycleHookConfig` 继续返回可执行 entries，并忽略 `enabled: false` entries。

### 4. 使用 `enabled` 字段表达停用状态

新保存格式使用对象 entry：

```json
{"command":"node ~/.echo/hooks/audit.js","timeoutMs":5000,"enabled":false}
```

选择 `enabled` 的原因是可读性强，和 MCP/skills 的管理心智一致。代价是旧版本 echo-tui 会忽略未知字段并执行该 entry；因此文档和 release note 需要说明停用状态依赖支持该字段的新版本。第一版实现不引入 `disabledHooks` 这类额外结构，避免配置碎片化。

### 5. 保存后 live reload dispatcher

当前 dispatcher 创建时持有固定 config。`/hooks` 保存后如果不 reload，用户会误以为保存立即生效但实际要重启。新增 dispatcher 更新能力，或在装配根持有可变 hooks service，使保存后执行：

```text
save hooks draft
  -> read/parse runtime hook config
  -> dispatcher.updateConfig(nextConfig)
```

已排队或正在运行的 hook job 不回滚；后续 emit 使用新配置。

### 6. 测试使用 synthetic payload，不触发真实生命周期

`/hooks test` 只验证 hook command 的执行契约。payload 由系统按 event 构造：公共字段包含 event、timestamp、cwd；事件字段使用当前 interaction mode 和稳定测试值，例如 `toolCallId: "hook-test-call"`、`toolName: "hook_test"`、`argumentsText: "{}"`。

这样避免为了测试而发起模型请求、执行工具或修改上下文。测试结果代表“这条命令能在 hook contract 下运行”，不代表真实业务 payload 覆盖所有分支。

### 7. 测试 executor 可捕获 bounded stdout/stderr，runtime executor 继续忽略输出

真实 hooks 继续使用忽略 stdout/stderr 的 executor，避免污染 TUI 和模型上下文。测试入口使用同样的 cwd/env/stdin/timeout 规则，但捕获 stdout/stderr 的前 N 字节并展示在 command surface 中，便于调试。

捕获输出只存在 command session 内存中，不追加 transcript、不写 session、不进入 provider request。输出展示需要截断并标注“真实运行时输出仍被忽略”。

## Risks / Trade-offs

- [Risk] `enabled: false` 在旧版本中可能仍被执行 → Mitigation：文档说明版本语义；保存格式保持简单，后续如需要强兼容可另开 change 迁移到 `disabledHooks`。
- [Risk] hook 测试输出可能包含敏感信息 → Mitigation：只展示测试模式输出、严格截断、不持久化、不写 transcript；避免默认把输出复制到模型上下文。
- [Risk] command 编辑长 shell 命令的交互复杂 → Mitigation：第一版使用现有 inline text edit 心智，保持最小字段集 command/timeout/enabled；不做 shell 语法解析。
- [Risk] live reload 和排队 hook job 存在时序差异 → Mitigation：定义为“已排队任务使用入队时 entry，后续 emit 使用新配置”，避免中途修改正在运行的子进程。
- [Risk] synthetic payload 被误解为真实事件样例 → Mitigation：UI 只在测试结果中显示“本次测试 payload”，完整字段文档仍放外部文档，文案明确 synthetic test 不触发真实生命周期。
