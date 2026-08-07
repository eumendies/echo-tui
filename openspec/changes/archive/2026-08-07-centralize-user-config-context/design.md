## Context

`~/.echo/config.json` 同时承载 App settings、LLM provider/model、工具、MCP 和 lifecycle hooks 配置。当前这些领域分别通过 `readAppSettings`、`readLlmConfig`、`readMcpConfig`、`readLifecycleHookConfig` 等入口同步读取文件；例如一次 agent run 会分别读取 App settings 和 LLM 配置，一次 watcher 回调也会分别刷新 `ModelContext` 与 `AppContext`。这既产生重复文件 I/O/JSON 解析，也可能让同一运行边界组合两个文件时刻的值。

现有消费者对错误的处理并不相同：LLM runtime 严格拒绝缺失或无效配置，App settings、MCP 和 hooks runtime 按各自规则容错，配置编辑草稿通常允许文件缺失但需要报告 malformed JSON。重构必须保留这些领域语义，而不能用统一的空对象或 last-known-good 策略掩盖错误。

TUI 已有 `config.json` watcher，App 和 Model 也已有局部内存缓存；headless 则是短生命周期且不应启动 watcher。配置写入使用增量节点更新和临时文件 rename，必须继续保留未知字段并避免基于陈旧内存覆盖磁盘上的外部修改。

## Goals / Non-Goals

**Goals:**

- 为每个 TUI 或 headless composition root 创建独立的 `UserConfigContext`，消除模块级共享状态。
- 一次文件读取和一次 JSON 解析形成不可变 revision snapshot；同一 snapshot 的不同领域 selector 复用该根对象且不再访问磁盘。
- 让调用方只取得 App、LLM、tools、MCP、hooks 或草稿所需投影，不暴露完整根对象和无关凭据。
- 让一次 assistant turn 的模型、reasoning、工具、压缩参数、指令文件名和自动审批 reviewer 固定来自同一 revision。
- 统一 watcher 的读取、内容去重与领域变化报告，同时保持 renderer、MCP 和 hooks 的现有副作用生命周期。
- 让配置保存基于磁盘最新内容原子写入，并在成功后立即更新内存 snapshot。
- 保留现有严格/容错 parser 行为和面向用户的脱敏错误。

**Non-Goals:**

- 不改变 `~/.echo/config.json` 的 schema、默认值或 provider preset 语义。
- 不把 `~/.echo/theme.json`、AGENTS/CLAUDE 指令、SYSTEM override、memory、skills、transcript、session model sidecar 或 OAuth token 内容纳入该 snapshot。
- 不因 watcher 检测到 MCP 或 hooks 节点变化而自动重连 server 或 reload dispatcher。
- 不引入模块级 singleton、后台配置服务、异步文件 API、数据库或第三方缓存依赖。
- 不在本变更中引入 last-known-good 配置回退；源文件损坏仍按现有各领域语义可见。

## Decisions

### 1. Context 位于 `src/config`，由 composition root 按实例创建

新增 `src/config/user-config-context.ts`。TUI `run()` 和 headless `runOnce()` 各自创建实例，并将受限 reader/snapshot port 注入 App、agent runtime、reviewer、MCP、hooks 和 command ports。Context 不作为模块级导出值，也不塞进 `AppContext` 内部创建。

选择 `src/config` 而不是 `src/app/state`，是因为 headless、MCP 和 agent runtime 同样需要该能力；由 composition root 创建则能保持自定义路径、测试隔离、watcher 清理和多实例边界。

### 2. 每次源变化创建不可变 snapshot，selector 在 snapshot 内按需缓存

Context 持有当前 `UserConfigSnapshot`：

```ts
type UserConfigSnapshot = {
  revision: number;
  sourceState: 'valid' | 'missing' | 'invalid_json' | 'invalid_root' | 'read_error';
  getAppSettings(): AppSettings;
  getAppSettingsDraft(): AppSettings;
  getLlmModelConfigInfo(): LlmModelConfigInfo;
  resolveLlmConfig(options?: ResolveLlmConfigOptions): LlmConfig;
  resolveLlmConfigForProfile(profileId: string): LlmConfig;
  getLlmConfigDraft(): LlmConfigDraft;
  getMcpConfig(): McpConfig;
  getMcpConfigDraft(): McpConfigDraft;
  getLifecycleHookConfig(): LifecycleHookConfig;
  getLifecycleHookConfigDraft(): LifecycleHookConfigDraft;
};
```

原始 root 保持私有，不提供通用 `getRoot()`。运行时 selector 可缓存冻结的解析图或安全值；可编辑 draft 每次返回深拷贝，避免 UI 修改污染 snapshot。LLM provider/model graph 与 tool runtime settings 分开缓存，profile/effort override 只执行内存查找和合并。

选择 snapshot 而不是在 Context 上维护大量可变 getter cache，是因为旧 snapshot 只要仍被 active turn 引用，就天然保持一致；刷新只需原子替换当前引用，不需要跨 revision 手工失效每个 cache。

### 3. 文件 I/O 与领域 parser 分层

现有领域模块继续拥有校验规则，但公开可从已解析 root 工作的纯函数：

- `normalizeAppSettings(root)`；
- `parseLlmConfiguration(root)`、`resolveLlmConfig(parsed, tools, options)`；
- `createLlmConfigDraft(root)`；
- `parseToolRuntimeConfig(root)`；
- `parseMcpConfigModel(root)` 及 runtime/draft 投影；
- `parseLifecycleHookConfig(root)` 及 draft 投影。

领域模块不再公开 `read*Config`/`save*Config` 文件 I/O 包装器，只保留从 root 工作的 parser、校验和增量变换。领域单测通过内存 `UserConfigContext` 或纯函数验证语义；生产配置文件读写只能经过 Context，`src/app`、`src/agent`、`src/commands`、`ModelContext` 和 `McpManager` 不得创建旁路读取边界。

选择保留领域 parser，而不是让 `UserConfigContext` 直接理解所有字段，是为了避免 god object，并确保 parser 可以独立测试和继续维护领域错误文案。

### 4. source state 与 parser 策略分离，不使用 last-known-good

文件读取层只分类 `valid`、`missing`、`invalid_json`、`invalid_root` 和 `read_error`，并保留足够的安全错误元数据。每个 selector 再按既有策略解释：

- LLM runtime/catalog 严格抛出脱敏领域错误；
- App settings runtime 对源错误和非法字段使用现有默认值；
- MCP/hooks runtime 保持现有可选能力降级与逐项诊断；
- App/LLM 草稿允许 missing，但 malformed JSON、invalid root 或读取失败继续报错；
- MCP/hooks 草稿保持当前容错和诊断行为。

无效源状态也可以成为新 revision，从而让 watcher 后的下一次消费看到当前磁盘故障，而不是静默继续使用旧凭据或旧工具。恢复为有效文件后，再安装下一 revision。

### 5. 使用语义 fingerprint 去重，并单独报告领域变化

有效根对象使用稳定 key 顺序序列化后计算 fingerprint；格式或缩进变化不增加 revision。无效 JSON 使用原始内容 fingerprint，missing/read error 使用分类状态 fingerprint。Context 在 fingerprint 未变化时不替换 snapshot，也不通知订阅者。

变化时计算 `appSettings`、`llm`、`tools`、`mcp`、`hooks` 等领域 fingerprint，并发布结构化 change set。未知根节点变化可以增加整体 revision，但不应伪造已知领域变化。

fingerprint 只保存在内存或 debug 安全摘要中，不记录原始配置、API key、headers 或环境变量值。

### 6. Context 拥有 watcher 读取，composition root 拥有副作用

TUI 调用 `startWatching()`，watcher debounce 后只调用一次 `refresh()`。Context 负责读取、解析、去重和通知；订阅者根据领域变化执行：

- LLM 变化：让 `ModelContext` 从新 snapshot 重算 catalog/session fallback，并清理失效 usage；
- App/tools 变化：替换 App settings 投影，并按既有规则重绘或清理 usage；
- MCP/hooks 变化：只更新 snapshot，不自动建立网络连接或启动进程。

`close()` 关闭 watcher 和 debounce timer。headless 只初始化/刷新一次，不调用 `startWatching()`。

### 7. assistant turn 显式捕获同一 revision

`runAssistantTurn` 在回合边界捕获一个 snapshot，并将从该 snapshot 解析出的运行配置或受限 snapshot port 同时交给 agent runtime 和 auto approval reviewer。`prepareAgent` 改为消费已解析 `LlmConfig`，不再自行读取文件。单轮的 tool continuation、compaction、skill catalog 和 reviewer 请求都复用该 revision。

`ModelContext` 继续管理 session model profile、effort override、sidecar 和 profile 删除后的回退，但改为读取注入的内存 selector，不再拥有磁盘 I/O。`/model`、`/effort`、`/status` 和 conversation reference 可以读取当前 snapshot；active turn 不因这些查询或 watcher 更新而切换配置。

### 8. 写入基于最新磁盘根，并在 rename 后立即安装 snapshot

领域 writer 改为通过 Context 的 update 边界执行：

1. 严格重新读取磁盘当前 root；
2. 按领域既有 missing/validation 规则执行增量变换；
3. 写临时文件并 rename；
4. 从写入结果安装新 snapshot；
5. 同步发布一次 change notification。

写入不以旧 snapshot root 为基底，避免 watcher 延迟期间覆盖外部修改。后续 watcher 观察到相同语义 fingerprint 时不再增加 revision或重复通知。LLM draft 在缺失文件时使用其既有 draft root fallback，MCP enabled 写回继续要求目标文件存在。

### 9. MCP 和 hooks 保持显式 reload 语义

`McpManager` 的 `loadConfig` 依赖改为读取 Context 当前 snapshot。`/mcp` 保存通过 Context 写入后，`reload()` 直接消费已安装的新 snapshot；若其他调用方独立请求 reload，composition root 先执行一次 `refresh()`。Manager 本身不再直接访问 `config.json`。

Hooks dispatcher 启动时消费 snapshot，`/hooks` 保存后继续显式 `updateConfig()`。外部 watcher 只报告 hooks 节点变化，不自动更新 dispatcher，避免本次架构重构扩大既有产品行为。

## Risks / Trade-offs

- [Context API 可能膨胀成所有配置逻辑的集中点] → Context 只管理 source/snapshot/lifecycle，字段校验和写入变换继续留在领域模块。
- [返回缓存对象后调用方可能意外修改共享状态] → root 不公开，runtime 投影使用只读/冻结值，编辑草稿始终返回深拷贝。
- [无效文件安装为新 revision 会让运行配置暂时不可用] → 这是现有重新读取语义的延续；各领域继续按原规则严格失败或降级，并在文件修复后恢复。
- [语义 fingerprint 和领域 fingerprint 增加少量 CPU] → 配置文件规模很小，稳定序列化仅发生在 refresh/write 边界，成本远低于分散重复 I/O。
- [写入前重读与外部写入仍存在最后写入者胜出的竞争窗口] → 保留现有原子 rename，并避免使用更陈旧的缓存根；完整跨进程锁不在本变更范围内。
- [迁移期间兼容 `read*` 与 Context 并存可能产生绕过] → 分阶段迁移生产调用点，最后增加架构测试限制 app/agent/commands 直接读取。
- [turn snapshot 需要穿过现有 `RunAgent` 和 reviewer 装配边界] → 只传内存中的受限运行配置或 snapshot port，不写 transcript、不持久化凭据，并以 controller/runtime 测试覆盖 revision 一致性。

## Migration Plan

1. 提取纯 parser 并新增 Context/snapshot，将原 `read*` 包装器测试迁移到 Context 后删除包装器。
2. 先迁移 agent runtime、`prepareAgent`、`ModelContext`、reviewer 和 conversation reference，建立单 turn revision 边界。
3. 再迁移 App settings、status/init/config、MCP 和 hooks command ports，并让所有 writer 走 Context update。
4. 将 `main.ts` 的 watcher 替换为 Context watcher/subscription；headless 使用无 watcher 的独立实例。
5. 增加直接读取架构测试，更新文档和规格，执行完整验证。

回滚时可基于保留的纯 parser 恢复旧 composition root 的文件读取入口，因为配置文件 schema 和领域 parser 行为未改变；新 Context 不写入额外持久化状态。

## Open Questions

无。首版明确不采用 last-known-good，不自动 reload 外部 MCP/hooks 变化，也不合并独立的 theme 配置生命周期。
