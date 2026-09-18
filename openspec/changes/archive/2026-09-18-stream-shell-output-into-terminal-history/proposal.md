## Why

shell mode 目前把一次执行的可见反馈拆成两段：运行期间只有 footer 里的临时 preview，命令本身要等第一个输出 chunk 才出现（`beginShellCommand` 未进入 pending 态）；命令结束后才把整块 `$ command + output` 一次性追加进终端历史区。长命令或静默命令运行期间基本看不到命令；输出再多也只是反复重绘一个被二次截断的预览窗口，滚动区没有任何可回看的过程内容，与真实终端体验差距明显。assistant 正文与 reasoning 已经有一套成熟的「稳定前缀增量确定 + footer 保留尾部」纪律（incremental-streaming-commit），shell 输出应复用同一纪律。

## What Changes

- shell mode 提交命令后立即把 `$ <command>`（shell-local 追加 ` [local]`）写入终端历史区，不再等待首个输出 chunk。
- 运行期间由 activity tick 把已稳定的完整输出行增量确定到终端历史区；footer pending preview 只保留尚未确定的尾部（含超预算时的既有摘要折叠），不再重复展示已进入历史区的行。
- 命令完成/中断/失败时，`shell` record 仍然只追加一条（append-only 不变），渲染层只补写尚未确定的投影与一次 record 尾部分隔；分批输出行序列 SHALL 等于一次性渲染最终 record block。
- shell ctx 输出超过共享上限并触发 offload/截断时，已确定头部保留，completion 追加最终 record 的完整投影（marker + 尾部）；这是记录口径收敛导致的唯一允许偏差（设计决策见 design.md）。
- destructive recovery（列宽变化、resize、主题切换等）SHALL 按当前宽度把运行中命令的已确定投影纳入完整快照并重建，不得重复或丢失。
- 运行中的输出仍然不是 transcript record，不进入 provider context；shell ctx/local 上下文边界与 bash tool 行为不变。
- 前置修复：`TurnContext.beginShellCommand` 进入 shell pending 态，使命令与 spinner 在提交后首帧即可见。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shell-mode`: live output 由「footer 临时 preview」改为「命令立即进入终端历史区 + 运行中按 tick 增量确定完整行 + footer 保留未确定尾部」；completion 补写与一次性渲染等价；ctx 超限时允许头部保留并追加最终投影。
- `terminal-tui-prototype`: 「高频 pending 更新使用统一活动刷新时钟」的 shell scenario 由「tick 绘制包含全部 chunk 的 pending preview」改为「tick 把新增已确定行投影到终端历史区并在 footer 保留未确定尾部」。

## Impact

- `src/app/state/turn-context.ts`：`beginShellCommand` 进入 pending 态；shell pending 携带 `commandLine`；shell record 构造迁至 `src/tools/shell-transcript-record.ts`。
- `src/types/render.ts`：`ShellOutputPendingState` 扩展字段与渲染层注入的已确定文本。
- `src/app/main.ts`：提交 shell 命令时传入 includeInContext。
- `src/render/app-renderer.ts`：新增 shell 增量确定状态（echo、已确定 offset、raw/sanitized 双坐标），completion 补写与 destructive replay 纳入 shell in-flight source。
- `src/render/blocks.ts`：shell echo / 未确定尾部渲染与稳定边界 helper。
- `src/render/footer.ts`：shell pending preview 改为只渲染未确定尾部。
- 测试：`test/app/app-context.test.js`、`test/render/app-renderer.test.js`、`test/render/blocks.test.js`、`test/render/footer.test.js`。
- 文档：`docs/tui-architecture.md` shell 子流程与渲染路径描述。
