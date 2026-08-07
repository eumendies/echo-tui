## 1. 纯配置解析边界

- [x] 1.1 导出并整理 App settings 的纯 root parser，使 runtime 与草稿读取复用同一字段归一化逻辑，同时保持 runtime 容错和草稿严格错误边界。
- [x] 1.2 将 LLM provider/model 解析拆为从 root 工作的纯 parsed graph、runtime profile resolver 和严格 profile resolver，并将 tool runtime 配置作为独立 root 投影缓存输入。
- [x] 1.3 将 LLM 配置草稿构造拆为从 root 工作的纯函数，确保返回草稿深拷贝且保留 root 中未知节点。
- [x] 1.4 将 MCP runtime/draft 的共享 model parser 改为接收 root，并保留 disabled/invalid server、逐 server 诊断和现有默认值语义。
- [x] 1.5 补齐 hooks draft 的纯 root parser，并让 runtime/draft 投影复用该 parser，保持 disabled entry 和诊断语义。
- [x] 1.6 将领域单元测试迁移到纯 parser 或内存 Context，证明 missing、malformed、invalid root、字段回退、严格 profile 和脱敏错误行为一致，并删除旧 `read*Config`/`save*Config` I/O 包装器。

## 2. UserConfigContext 与不可变 snapshot

- [x] 2.1 新增实例级 `UserConfigContext`、`UserConfigSnapshot`、source state、revision 和结构化 domain change 类型，为所有新增结构字段添加中文领域注释。
- [x] 2.2 实现单次读取/JSON 解析的 snapshot 安装、稳定语义 fingerprint 和无变化去重；无效 JSON、missing、invalid root 与 read error 也需形成可比较的安全 source state。
- [x] 2.3 实现 App、LLM、tools、MCP、hooks 和草稿 selector 的 revision 内 lazy cache；不公开 root，runtime 值只读，编辑草稿返回不会污染缓存的深拷贝。
- [x] 2.4 实现 `capture`、`refresh`、subscribe/unsubscribe 和 `close` 生命周期，并扩展 watcher 支持注入 config path、文件依赖和现有目录监听/轮询 fallback。
- [x] 2.5 实现按已知配置节点计算 domain change set，未知节点变化只更新整体 revision，不伪造 App、LLM、tools、MCP 或 hooks 变化。
- [x] 2.6 增加 Context 单元测试，覆盖多 selector 单次读取、重复 selector 零 I/O、相同语义内容不增加 revision、有效/无效状态切换、订阅取消、多实例隔离和 watcher 关闭。

## 3. 基于最新磁盘的配置写入

- [x] 3.1 为 Context 增加领域 update 边界：写入前重新读取磁盘最新 root，执行同步增量变换，沿用临时文件 rename，并仅在成功后安装新 snapshot。
- [x] 3.2 迁移 App settings 与 LLM draft writer，保持字段校验、未知节点保留、LLM 缺失文件的 draft root fallback 和写入错误文案。
- [x] 3.3 迁移 MCP enabled state 与 hooks draft writer，保持 MCP 目标文件必须存在、hooks 可首次创建及各自只修改所属节点的语义。
- [x] 3.4 增加 writer 测试，覆盖外部新增字段不被陈旧 snapshot 覆盖、保存后 selector 立即可见、watcher 重复事件不二次通知，以及校验/read/write/rename 失败不安装草稿。

## 4. Agent 与模型运行快照

- [x] 4.1 调整 `prepareAgent` 接受已解析 `LlmConfig`，移除其内部文件读取，同时保持默认工具、MCP 工具和 tool result store 的装配行为。
- [x] 4.2 在 assistant turn 边界捕获单个配置 snapshot，并让 agent runtime 从中一次性解析 provider/model、reasoning、tools、指令文件名、压缩阈值和 skill catalog 比例。
- [x] 4.3 调整 `AgentSessionInput`、运行时 port 或等价内存边界，使同一 turn 的 provider streaming、compaction 与 tool continuation 固定使用捕获 revision，且配置凭据不进入 transcript 或持久化记录。
- [x] 4.4 重构 `ModelContext` 注入模型目录与 runtime resolver port，移除所有磁盘读取；保留 session profile/effort、sidecar、有效选择保持、profile 删除回退、footer fingerprint 和 usage 清理语义。
- [x] 4.5 让自动审批 reviewer 严格从当前 turn 的同一 snapshot 解析 profile，保持 reasoning `none`、无工具 agent、fail-closed 和 abort 传播行为。
- [x] 4.6 迁移 conversation reference、手动 compact 和其他 `prepareAgent`/LLM 读取入口，使每个操作显式使用当前 snapshot 且不产生隐藏配置 I/O。
- [x] 4.7 扩展 agent、ModelContext、reviewer 和 controller 测试，覆盖 active turn 中途 refresh 不变、下一 turn 使用新模型/reasoning/tools、reviewer 与主 agent 同 revision、session 选择保持及 profile 删除回退。

## 5. App、命令与配置生命周期迁移

- [x] 5.1 在 TUI composition root 创建并注入唯一 `UserConfigContext`，使用初始 snapshot 创建 App settings、ModelContext、MCP manager 和 hooks dispatcher。
- [x] 5.2 将 App settings 刷新改为应用传入 snapshot 投影，保留 reasoning visibility 的 destructive replay、slash limit 的 footer redraw 和相关 usage 清理规则。
- [x] 5.3 迁移 `/status`、`/config` 常规/模型草稿、审批模型候选和 `/init` workflow，消除 command/handler 内直接配置读取并保持现有错误与展示语义。
- [x] 5.4 迁移 `/mcp` command 和 `McpManager.loadConfig` 到 snapshot selector；保存后消费已安装 revision 执行一次显式 reload，独立 reload 前由 composition root 刷新 Context。
- [x] 5.5 迁移 `/hooks` command 到 snapshot draft/writer；保存后继续显式更新 dispatcher，外部 watcher 的 hooks domain change 不自动执行进程 reload。
- [x] 5.6 统一 `main.ts` watcher 订阅，使单次 refresh 同时驱动 ModelContext、App settings、重绘和 usage 清理；移除分别刷新模型与设置造成的重复读取。
- [x] 5.7 增加 command host、AppContext、MCP、hooks 和 watcher 集成测试，覆盖同一 revision 投影、保存即时刷新、重复通知去重及 MCP/hooks 既有显式 reload 边界。

## 6. Headless、范围约束与架构清理

- [x] 6.1 在 `runOnce` 创建单次用户配置上下文，并让 MCP、hooks 和 agent 共用其 snapshot；确认 headless 不启动 watcher且清理流程不新增长期资源。
- [x] 6.2 保持 theme、AGENTS/CLAUDE、SYSTEM override、memory、skills、transcript、session sidecar 和 OAuth token 的现有读取生命周期，不把这些资源接入用户配置 revision。
- [x] 6.3 清理生产路径的直接 `read*Config` 调用与领域 I/O 包装器，只允许 TUI/headless composition root 创建 Context，并要求 agent runtime、ModelContext 和 MCP manager 显式接收配置 port。
- [x] 6.4 增加架构测试，阻止上述生产目录重新引入 `readAppSettings`、`readLlmConfig`、`readMcpConfig`、`readLifecycleHookConfig` 或直接 `JsonConfigFile` 访问。
- [x] 6.5 更新现有测试替换缝，优先注入独立 Context、snapshot 或领域 port，避免通过修改模块导出共享配置状态。

## 7. 文档与验证

- [x] 7.1 更新 `docs/tui-architecture.md`，记录 UserConfigContext、不可变 revision、ModelContext 磁盘边界、writer 和 TUI/headless 生命周期。
- [x] 7.2 更新相关用户与架构文档，说明配置变化在下一 turn 生效、watcher 非零延迟、MCP/hooks 显式 reload 和 malformed 配置行为。
- [x] 7.3 运行 `npm run typecheck` 并修复全部类型错误。
- [x] 7.4 运行 `npm test` 并确保新增及既有测试全部通过。
- [x] 7.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 并修复全部 JavaScript 语法错误。
- [x] 7.6 整理交付给用户的手动验证清单，覆盖外部编辑、`/config`、`/model`、`/status`、`/mcp`、`/hooks`、active turn 配置隔离和 `--once`。
