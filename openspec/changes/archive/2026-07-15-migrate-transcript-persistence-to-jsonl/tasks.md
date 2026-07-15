## 1. Journal 协议与 reducer

- [x] 1.1 在 transcript 类型协议中定义 JSONL header、递增序号、独立操作、batch 子操作和增量 store API，移除完整 `saveSession` 协议。
- [x] 1.2 新增纯 journal 模块，实现操作构造、单行校验、seq 校验、batch 应用和向 `TranscriptSession` 的 replay reducer。
- [x] 1.3 为 journal reducer 添加 records 追加/截断、三类状态独立覆盖、batch 原子重放、尾行容错和中间损坏拒绝测试。

## 2. JSONL transcript store

- [x] 2.1 重写 transcript store，使首次 session 通过临时文件原子创建 header 与首个操作，后续更新只追加单个 JSONL 操作。
- [x] 2.2 将 session 路径改为 `.jsonl`，保留项目 metadata，删除完整 JSON 快照写入、旧 `.json` 枚举和旧格式读取实现。
- [x] 2.3 通过 journal replay 实现 `loadSession` 和 `/resume` metadata 派生，确保截断 records 不出现在当前恢复结果和预览中。
- [x] 2.4 重写 transcript store 测试，覆盖创建、增量写入量、恢复、列表、尾行中断、无效 journal 与旧 JSON 忽略行为。

## 3. App 持久化集成

- [x] 3.1 改造 `TranscriptContext`，移除完整 current session records 副本，维护 journal 引用、seq 和三个独立 pending 状态。
- [x] 3.2 实现单条及批量 records 追加，使普通 records 仅追加 records 操作，并让 tool call/result 与 provider records 复用批量 journal 写入。
- [x] 3.3 将 compaction 状态与 notice 持久化为单行 batch，并保持 todo 与 change history 仅在各自变化时追加独立状态操作。
- [x] 3.4 调整 `/undo` 持久化路径，使 records 截断、目标 compaction 和 pop 后 change history 在同一 batch 中提交且恢复语义不变。
- [x] 3.5 更新 AppContext、assistant turn runner、TurnContext 及其 fake transcript store 测试，覆盖 todo、compaction、tool pair、连续 undo 和恢复后的 provider 上下文。

## 4. 文档与验证

- [x] 4.1 更新 README 和 TUI 架构文档，说明单 session JSONL 路径、append-only journal、replay 成本、旧 JSON 不兼容和历史保留边界。
- [x] 4.2 运行 `npm run typecheck`、`npm test` 与 `find bin src test scripts -name '*.js' -exec node --check {} \;`，修复回归。
