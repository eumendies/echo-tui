## Why

当前 assistant streaming 正文和 reasoning 预览完整存放在 footer pending 临时区域，随 draft 增长会超出 footer 高度预算，只能折叠头部、以 `…已生成 N 行，显示最新 K 行` 的方式截断显示；用户在长回答生成过程中看不到已经流出的完整历史内容。此前 reasoning 最终摘要重复提交的问题已修复，但 streaming 内容能否不可逆写入 terminal scrollback 仍取决于正文 Markdown 投影稳定性，以及 provider reasoning draft 的追加顺序约束。

## What Changes

- 引入 in-flight streaming 增量确定机制：assistant 正文把当前 provider segment 中已稳定的 Markdown 块前缀逐次确定到 terminal scrollback，footer pending 只保留尚未成功写入当前可见 scrollback 的尾部（含未稳定内容与 queued source）。
- Markdown 提供与最终 renderer 共享 fence/table 判定的 source boundary scan；table header candidate、未闭合 fence/table 和 draft 末块均保留在 footer，避免后续 token 改变已确定投影。
- reasoning 纯文本按当前终端宽度增量确定完整视觉行：每个 activity tick 把除最后一个仍可能增长的视觉行外的前缀写入 scrollback，不等待 provider done；`response.completed` 仍只发送唯一 complete。
- 第一个正文 token 到达时 reasoning 显示阶段结束：先把当时已有的 reasoning 尾行写入 scrollback，再开始正文尾部；此后迟到的 reasoning draft/complete 只更新并提交完整 transcript 事实，不再追加到正文之后。destructive replay 使用完整最终 records，因此恢复后可展示完整 reasoning。
- 每个工具循环中的 provider draft 是独立 assistant segment；正文确定进度只在当前 segment 内单调增长，segment record 落盘后重置，不能跨 segment 沿用文本游标。
- token callback 只更新 draft；activity tick 批量 drain。assistant record finalize 直接使用完整 record 补写未显示尾部；reasoning record 仅在正文尚未开始时补写尾部，正文开始后只结束显示状态。首正文 token 与插入 retry/compaction notice 前才同步 drain，覆盖“首个 tick 前完成”的时序。
- 最终 assistant record、reasoning summary record、工具调用前 segment record 仍作为 append-only 事实提交；assistant 渲染补写未确定正文，reasoning 仅在正文尚未开始时补写尾部，避免重复或错序。
- destructive recovery 按当前宽度从 records 与选定 replay boundary 之前的 in-flight source projection 重新生成快照，不复用旧宽度下的物理行差分。
- 中断和失败保留已确定行，并用完整当前 assistant/reasoning draft 创建 partial records；正文开始后不补写迟到 reasoning，只补写 assistant 尾部，随后追加 notice 或 error。
- `showReasoningSummary=false` 时 reasoning 不焊入 scrollback；现有 transient footer preview 可继续显示，最终 summary record 仍提交事实但不渲染。
- 主会话与 BTW side conversation 使用同一增量确定语义，并显式隔离 terminal projection owner：BTW 活跃时后台主 turn 可推进状态，但不得向 BTW scrollback 写入。
- streaming 正常内容不再因 footer 高度预算折叠；正文仅对单个未闭合 Markdown 块保留有界尾部兜底，reasoning 仅保留最后一个仍可能增长的视觉行。

## Capabilities

### New Capabilities
- `incremental-streaming-commit`: 定义 Markdown/纯文本增量边界、per-segment 增量确定、节流 drain、reasoning finalize、完成/中断/失败一致性和可见投影所有权。

### Modified Capabilities
- `terminal-tui-prototype`: streaming pending 从“折叠完整 draft”改为“terminal scrollback 保存 in-flight committed projection，footer 只显示尚未 visibly committed 的尾部”，并明确结构性事件 drain 与 destructive recovery。
- `btw-side-conversation`: side streaming 使用同一机制，并隔离 BTW 与后台主 turn 的 terminal 输出。

## Impact

- `src/render/markdown/index.ts`、`src/render/markdown/markdown-table.ts`：提供可供 streaming 复用的 source boundary scan 和 table candidate 判断。
- `src/render/blocks.ts`：新增可确定 source prefix、正文消息投影差分、record finalize suffix 和 pending tail 渲染。
- `src/types/agent.ts` 及 provider adapters：统一 reasoning draft 与唯一 complete 事件语义。
- `src/types/render.ts`、`src/render/app-renderer.ts`：新增 in-flight projection 与稳定行 append API；destructive replay 按当前宽度重投影。
- `src/app/state/turn-context.ts`、`src/app/assistant-turn-runner.ts`、`src/app/main.ts`：管理 per-segment draft、activity drain、reasoning finalize、partial records 和 main/BTW 投影隔离。
- `src/app/btw-conversation-controller.ts`：复用 side turn 增量状态并隔离迟到 callback。
- 更新 render、adapter、turn runner、app context 与 BTW controller 测试。
- 不引入新运行时依赖、不切换 alternate screen、不引入第三方 TUI 库。
