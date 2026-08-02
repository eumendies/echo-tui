## Why

当前用户若想基于现有对话尝试另一条路径，只能继续写入原 session，或通过 `/resume` 切换后直接修改历史会话，无法保留一个可独立继续的分支。增加 `/fork` 可以在不丢失当前上下文的前提下创建独立会话，让原会话和新会话分别演进。

## What Changes

- 新增 `/fork` 本地 slash command，从当前非空 session 的最新状态创建独立会话并立即切换过去。
- 分叉会话复制当前 transcript records、compaction、todo state、change history 以及当前 model/effort 设置；分叉成功后的追加只写入新 session。
- 分叉过程使用自包含 JSONL snapshot，不依赖源 session 进行后续 replay，也不复制工作目录、Git 状态或文件系统。
- 使用瞬时 command surface 展示成功、空会话或失败结果，不向 transcript 追加 `/fork` 命令或成功 notice。
- 将 `/fork` 注册到默认命令、slash suggestion、帮助和用户文档中。

## Capabilities

### New Capabilities
- `session-fork-command`: 定义 `/fork` 的命令匹配、会话快照复制、当前 session 切换、模型设置继承、反馈和失败原子性。

### Modified Capabilities

无。

## Impact

- 影响 slash command 注册与帮助：`src/commands/`、`src/commands/resolve-slash-command.ts`。
- 扩展 `CommandHost` transcript 领域端口以及 `AppContext`、`TranscriptContext`、`ModelContext` 的会话协调能力。
- 复用现有 transcript journal batch/createSession 和 settings sidecar，不引入新运行时依赖或 journal schema。
- 需要更新 command、app context、持久化独立性相关自动化测试，以及 README、架构文档和交互验证清单。
