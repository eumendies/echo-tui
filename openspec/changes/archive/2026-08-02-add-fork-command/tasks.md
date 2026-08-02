## 1. 会话分叉领域能力

- [x] 1.1 在 transcript/command 类型中定义结构化 fork 成功、空会话和失败结果，并扩展 `CommandHost.transcript` 受控接口
- [x] 1.2 在 `TranscriptContext` 实现当前稳定 session 的自包含 batch 快照创建，只在新 journal 创建成功后切换 session reference
- [x] 1.3 在 `ModelContext` 增加把当前 model/effort 强制绑定到新 session 的 best-effort sidecar 同步能力，并保留失败后的重试状态
- [x] 1.4 在 `AppContext` 协调 transcript 分叉、model settings 继承和 context usage 清理，并通过 transcript command port 返回脱敏的结构化结果

## 2. `/fork` 命令与界面集成

- [x] 2.1 新增 `ForkCommandHandler`，实现无参数匹配、立即分叉以及成功、空会话、失败三类 info surface，且不追加 transcript record
- [x] 2.2 将 `/fork` 注册到默认 slash handlers 和 descriptors，更新 `/help` 命令列表并保持 direct skill fallback 顺序
- [x] 2.3 确认成功提示包含新 session id、源 session 可恢复说明和“不复制工作目录/Git/文件系统”的边界说明

## 3. 自动化测试

- [x] 3.1 扩展 AppContext/TranscriptContext 测试，覆盖完整 records、compaction、todo state、change history 快照及分叉后的新旧 journal 独立追加
- [x] 3.2 增加空会话与 journal 创建失败测试，验证不创建空 session、失败后仍指向源 session 且内存状态不变
- [x] 3.3 增加 model/effort sidecar 继承与写入失败测试，验证当前内存选择保留、源 sidecar 不改写且后续可重试
- [x] 3.4 扩展 slash command 测试，覆盖 `/fork` 匹配边界、默认注册/descriptor、三类反馈和关闭 surface 行为
- [x] 3.5 使用真实 transcript store 增加分叉 session replay 测试，验证子 journal 自包含且源会话后续变化不影响子会话

## 4. 文档与验证

- [x] 4.1 更新 README 会话命令与存储说明，明确 `/fork` 复制的会话状态、独立追加语义和共享工作目录限制
- [x] 4.2 更新 TUI 架构文档和 AGENTS.md 命令/手动验证清单，记录 fork 的 CommandHost、AppContext 与持久化职责边界
- [x] 4.3 依次运行 `npm run typecheck`、`npm test` 和 JavaScript `node --check` 批量检查
- [x] 4.4 由用户在交互式 TUI 中验证成功分叉、空会话提示、`/status` session id 切换、两侧 `/resume` 独立继续及 `/undo` 共享工作区警告
