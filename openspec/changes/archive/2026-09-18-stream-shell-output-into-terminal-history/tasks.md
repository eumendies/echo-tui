## 1. 前置状态与 pending 口径

- [x] 1.1 `TurnContext.beginShellCommand` 进入 `shell_output` pending 态，使命令提交后首个投影即可见；保持 response lock、working spinner 与 Esc 中断语义不变。
- [x] 1.2 shell pending 携带 `commandLine`（与 shell record 首行同源，由 `src/tools/shell-transcript-record.ts` 的 `formatShellCommandLine` 生成）以及仅由 renderer 注入的未确定尾部起点（`historyRawLength`）；命令行模板只保留一处实现。
- [x] 1.3 `src/app/main.ts` 的 `submitShellCommand` 传入 `includeInContext`，保持 shell ctx/local 上下文边界与 runner 捕获/offload 参数不变。
- [x] 1.4 `test/app/app-context.test.js`：提交后 `getPending()` 立即返回 shell pending；pending 的 `commandLine` 与 shell record 首行同源一致。

## 2. 稳定边界与增量确定

- [x] 2.1 `src/render/blocks.ts` 增加 shell 稳定边界 helper：按与 record 展示相同的净化口径（CRLF 归一、孤立 CR 删除）用 1 字符 carry 对 delta 增量净化，返回 compact prefix 的 raw/sanitized 双游标。
- [x] 2.2 `src/render/blocks.ts` 增加 shell echo 投影：`$ <command>`（shell-local 追加 ` [local]`）与 block 前导空行，行尾换行 framing 与最终 block 一致。
- [x] 2.3 `src/render/app-renderer.ts` 增加按 owner 键控的 shell commit 状态（echoCommitted、sanitizedCommittedLength、rawCommittedOffset），在 `render()` 中完成首帧 echo 与每个 tick 的新增稳定行确定。
- [x] 2.4 `prepareRenderState` 向 shell pending 注入未确定尾部起点，footer 只渲染该起点之后的原始文本；没有未确定尾部时不占用 pending 行。
- [x] 2.5 `renderShellOutputPendingLines` 改为只渲染未确定尾部（移除命令与已确定行），保留超预算时的摘要 + 尾部折叠。
- [x] 2.6 确认确定与 footer 重绘在同一 `output.write()` 帧内完成；chunk 回调仍只更新 draft，不直接触发终端写入。

## 3. completion、分歧与回放

- [x] 3.1 `renderRecords` shell 分支：存在 commit 状态且净化后 record 文本以已确定文本为前缀时，只补写后缀并恰好追加一次 record 尾部 spacer；无状态时保持完整 block 既有行为。
- [x] 3.2 ctx 超限分歧路径：前缀校验失败时以 echo 边界补写最终 record 投影（marker + 尾部 + 尾注），不重复命令行、不删除已写入历史区的行。
- [x] 3.3 中断/失败路径复用同一 completion 补写（含 `[exit <code>]`、timeout、truncated 与 error 尾注）。
- [x] 3.4 `renderDestructive` 把 shell in-flight 投影纳入完整快照并按当前宽度重投影，恢复后确定游标保持一致；非 main owner 期间不写入历史区，恢复时由 destructive replay 重建。

## 4. 测试

- [x] 4.1 renderer 等价性主判据：用 fake output 捕获写入序列，断言「echo → 多次 tick → completion」的滚动区文本等于一次性 `renderShellBlock(record.text)` 投影；覆盖仅命令无输出、无换行输出、跨 chunk 多行输出、CR 进度条。
- [x] 4.2 边界与分歧：ctx 超限（头部已确定 + marker/尾部 completion）不重复命令行；Esc 中断尾注补写不重复已确定行；快速命令早于首个 tick 时一次性渲染。
- [x] 4.3 清理与回放：destructive replay（列宽变化、BTW 往返）后不重复、不丢失且游标可继续推进；`/resume`、`/fork` replay 路径不触发增量状态。
- [x] 4.4 更新既有断言到「仅未确定尾部」口径（`blocks`/`footer`），确认 assistant/reasoning 增量确定行为不变。

## 5. 文档与验证

- [x] 5.1 `docs/tui-architecture.md` 同步 shell 子流程、渲染路径、pending preview 与 owner 隔离描述。
- [x] 5.2 `npm run typecheck`
- [x] 5.3 `npm test`
- [x] 5.4 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.5 `openspec validate stream-shell-output-into-terminal-history --strict`
- [x] 5.6 交互式手工验证：`sleep 3; echo done`（命令首帧可见、输出在 completion 补写）、持续输出命令（逐 tick 落入历史区）、CR 进度条输出、Esc 中断、列宽变化、BTW 往返、shell local/ctx 各自的输出上限行为、`/resume` 后 shell record 回放。
