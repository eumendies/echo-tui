## Why

当前 transcript 每追加一条记录或更新会话状态，都会克隆、序列化并原子替换完整 session JSON。随着 records 增长，单次写入和累计写入量都会线性放大，长会话的累计成本接近 O(n²)。

transcript records 天然是追加事实，todo、压缩状态和 change history 也可以按各自变化独立记录；应改为单 session JSONL journal，避免无关状态和历史 records 的重复写入。

## What Changes

- **BREAKING** 将 transcript session 的持久化文件从单个完整 `.json` 快照改为单个 `.jsonl` journal；新实现不读取、迁移或兼容旧 `.json` session 文件，schemaVersion 继续为 `1`。
- 为 session journal 定义首行初始化事件、record 追加、record 截断、todo 状态、compaction 状态和 change history 状态等增量操作；只有实际变化的状态写入日志。
- 为 compaction notice 和 `/undo` 等需要同时修改多项事实的路径定义单行 batch 操作，保证 replay 不会观察到半完成的逻辑状态。
- 重写 session 加载与 `/resume` 列表派生逻辑，通过顺序 replay journal 恢复当前 transcript、三个运行时状态和 session metadata。
- 保持现有 TUI、provider transcript、todo、compaction、连续 `/undo` 与 `/diff` 的外部行为不变，并删除完整 session 覆盖写实现。

## Capabilities

### New Capabilities
- `transcript-journal-persistence`: 定义单文件 JSONL transcript journal 的追加、replay、损坏尾行容错、状态独立持久化和 session 列表派生行为。

### Modified Capabilities
- `session-todo-management`: 将 todoState 的持久化载体从顶层 session JSON 改为 transcript journal 的独立状态操作，移除旧 session 缺少 todoState 的兼容要求。

## Impact

- 受影响代码：`src/types/transcript.ts`、`src/persistence/transcript-store.ts`、新增 journal reducer 模块、`src/app/state/transcript-context.ts`、`src/app/state/app-context.ts`、`src/app/state/turn-context.ts`、`src/app/assistant-turn-runner.ts`。
- 受影响测试：持久化 store 测试、journal reducer 测试、AppContext 与 assistant turn runner 的 fake transcript store 及 undo/todo/compaction 回归测试。
- 受影响文档：README 会话路径，以及 TUI 架构中的 transcript store 与持久化流程说明。
- 正常追加路径从完整 session 重写改为单行 JSONL append；加载和 `/resume` 需要扫描并 replay 对应 journal，且 undo 后的历史物理保留在日志中。
