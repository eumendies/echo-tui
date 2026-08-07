## Why

当前 `~/.echo/config.json` 由 agent runtime、模型状态、命令端口、MCP、hooks 等模块分别同步读取和解析，单次 turn 或一次 watcher 通知可能重复访问同一文件，并可能让同一运行边界组合来自不同文件时刻的设置。需要建立实例级统一配置上下文，在保持现有领域校验和生效时机的前提下减少重复 I/O，并为 TUI 与 headless 提供一致的配置快照边界。

## What Changes

- 新增实例级 `UserConfigContext`，一次读取并解析用户配置根对象，以不可变 revision snapshot 向调用方提供最小领域 selector。
- 将 App settings、LLM、tools、MCP、hooks 和配置草稿的文件 I/O 与纯领域解析拆开；同一 snapshot 内重复 selector 不再访问磁盘。
- TUI 统一由配置上下文管理 `config.json` watcher、内容去重和变化通知；普通 footer/render 路径继续只读内存状态。
- assistant turn 在开始时捕获一致的配置 snapshot，主 agent、工具 registry、压缩参数和自动审批 reviewer 在该 turn 内不因外部刷新而改变；后续 turn 使用最新成功安装的 revision。
- 配置写入继续基于磁盘最新根对象执行增量修改和原子替换，成功后立即安装新 snapshot；随后重复的 watcher 事件不再次发布同一内容。
- 保持现有严格与容错语义：LLM runtime 继续严格报告无效配置，可选 App/MCP/hooks runtime 继续按各自既有规则降级，配置草稿继续区分文件缺失与 malformed JSON。
- MCP 与 hooks 的网络或进程级 reload 仍由现有显式生命周期入口触发；中心化 watcher 只报告领域变化，不擅自扩大副作用。
- headless 每次进程运行创建独立配置上下文且不启动长期 watcher；theme、项目指令、memory、skills、session sidecar 和 OAuth token 不纳入该 snapshot。

## Capabilities

### New Capabilities
- `user-config-context`: 定义用户配置的实例级快照、领域 selector、刷新去重、写后同步、错误语义和 TUI/headless 生命周期。

### Modified Capabilities
- `streaming-llm-service-adapter`: 将“每次后续消息重新读取配置文件”调整为“每次运行捕获配置上下文的最新 revision”，并要求单个运行期间配置一致。
- `config-surface-settings`: 将 App settings 与工具设置的独立缓存刷新接入统一配置 snapshot，同时保持现有下一轮生效和重绘语义。
- `mcp-tool-integration`: MCP reload 改为先刷新并消费配置上下文的最新 snapshot，而不是由 manager 独立重新读取配置文件。

## Impact

- 主要影响 `src/config/`、`src/agent/agent-loop-runtime.ts`、`src/agent/agent-setup.ts`、`src/app/main.ts`、`src/app/state/`、`src/app/command/`、`src/mcp/manager.ts`、hooks 装配和 `src/cli/one-shot.ts`。
- 删除已无生产调用的 `read*Config`/`save*Config` 文件 I/O 包装器；领域模块只保留纯 root parser、校验和增量变换，所有生产读写统一经过配置上下文或 snapshot。
- 不新增第三方依赖，不改变 `config.json` 格式，不改变 provider、MCP 或 hooks 的外部协议。
- 需要更新配置 parser、watcher、写入、turn snapshot、ModelContext、headless 和架构边界测试。
