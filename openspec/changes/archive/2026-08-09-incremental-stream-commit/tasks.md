## 1. Markdown 稳定边界与投影等价

- [x] 1.1 在 `src/render/markdown/index.ts` 暴露供 streaming 使用的 block source range/completeness 元数据，或提供语义等价的 boundary scan API；与最终 renderer 共享 fence/table 判定，不复制一套松散 parser
- [x] 1.2 识别 draft 末块、未闭合 fence、table header candidate、不完整 delimiter、仍可扩展 table、table 后仅有空白行以及 `markdown` fence 内 table，返回稳定 source prefix 边界
- [x] 1.3 在 `src/render/blocks.ts` 新增基于 assistant/reasoning 正文消息 renderer 的 source-prefix 投影和差分；覆盖角色前缀、continuation 缩进、ANSI 样式与 wrap，但增量正文不得提前包含 record 尾部 spacer
- [x] 1.4 改写 streaming/reasoning pending renderer，使 tail 从 record 中间继续投影而不重新显示第二个角色前缀；仅对未闭合块或尚未进入终端历史区的 reasoning 尾行保留有界折叠
- [x] 1.5 在 `test/render/blocks.test.js` 增加逐 token fixtures：普通段落、table header→delimiter→rows→后续非空块、未闭合/闭合 fence、markdown fence 内 table、宽字符 wrap；断言分批行序列等于最终 record 一次性投影
- [x] 1.6 更新 `test/render/footer.test.js` 中旧的整段 streaming collapse 断言，覆盖 continuation prefix、稳定块不折叠与不稳定超长块兜底

## 2. Reasoning draft 与完成边界

- [x] 2.1 在 `src/types/agent.ts` 用 provider-neutral reasoning update 表达当前完整 draft 与唯一 complete；为新增结构字段添加中文语义注释
- [x] 2.2 更新 OpenAI Responses adapter：delta/done 更新 preview，`output_item.done` 校正完整预览，`response.completed` 只发送一次 complete
- [x] 2.3 更新 OpenAI Chat 与 Anthropic adapter，在 reasoning→正文/tool 或 thinking block stop 边界报告 complete，保持现有 provider-private records 语义
- [x] 2.4 在 provider adapter tests 覆盖：Responses 多个 part 合并、output item 完整预览校正、Chat/Anthropic complete 先于正文，以及 complete 不重复

## 3. Per-segment streaming state 与 activity drain

- [x] 3.1 在 `src/app/state/turn-context.ts` 只保存当前 assistant segment 与 reasoning 的完整草稿；稳定边界和已显示进度不进入业务 context
- [x] 3.2 `setStreamingPending` / reasoning draft callback 只更新完整草稿；正文 Markdown 边界、reasoning 视觉行边界和已显示文本统一由 renderer 管理
- [x] 3.3 首个正文 token 通过完整 `RenderState` 让 renderer 先推出当时已有的 reasoning 最后视觉行并关闭其实时显示阶段；迟到 reasoning 只更新完整事实草稿，不插入正文；正常 reasoning record 只由 provider complete 创建，失败/中断才消费未完成草稿创建 partial record
- [x] 3.4 实现 segment finalize：直接用完整 segment record 让 renderer 补写剩余部分并结束流式状态，然后清空正文草稿；工具结果后的 provider run 从新 segment 开始
- [x] 3.5 完成、中断和失败使用完整当前草稿创建 records；正文未开始时补写 partial reasoning 尾部，正文已开始时只保存完整 reasoning 事实；assistant 补写未显示尾部，随后追加 notice/error 并释放 response lock
- [x] 3.6 `clearPending`、新 user turn、manual compaction、正常完成、失败、中断和迟到 turn cleanup 按生命周期重置正确草稿，不能提前丢弃 finalize 所需内容
- [x] 3.7 在 `test/app/app-context.test.js` 覆盖 TurnContext 只维护完整草稿，以及 reasoning/assistant pending 的阶段切换

## 4. Runner 接线与结构性事件顺序

- [x] 4.1 在 `src/app/assistant-turn-runner.ts` 让 token/reasoning draft 只排队，activity tick 批量 drain；把 terminal commit port 显式注入 runner/context
- [x] 4.2 reasoning complete、`onAssistantSegment`、`onComplete` 和 catch 通过完整 record 结束流式状态；正文开始后的 reasoning record 不补写迟到尾部；普通状态变化、首正文 token 与插入 retry/compaction notice 前统一调用 `render`，由 renderer 同时处理 activity drain 和 footer redraw
- [x] 4.3 确保 tool loop 中每个 provider draft 是独立 segment，屏幕顺序为 reasoning → assistant segment → tool call/result → 新 assistant segment
- [x] 4.4 覆盖：多 token 单 tick 合并、completion/tool call 早于首 tick、Responses 首个正文 token 关闭 reasoning 显示且迟到 draft/complete 不插入正文、Chat/Anthropic complete 早于正文、两个工具 segment、失败/中断、provider retry/compaction notice 顺序

## 5. Renderer 与 destructive replay

- [x] 5.1 在 `src/types/render.ts` 定义统一 `AppRenderer.render` 与流式 record 内容类型；所有结构化字段添加中文语义注释
- [x] 5.2 在 `src/render/app-renderer.ts` 内部计算稳定文本与已显示文本的新增行，并在一个终端帧中执行清 footer → 追加新行 → 重绘 footer；renderer 不持有 transcript 事实
- [x] 5.3 扩展 `renderDestructive`，按当前 width/theme 从 records 与完整 pending 状态重算界面，并同步当前 owner 的已显示进度，禁止复用旧物理行数
- [x] 5.4 在 `test/render/app-renderer.test.js` 覆盖 append 不重放旧历史、增量正文不提前写 suffix且 finalize 恰好追加一次 spacer、columns 变化重排、theme 变化重投影、reasoning 过滤和无重复 replay

## 6. Main/BTW projection owner 隔离

- [x] 6.1 在 `src/app/main.ts` 建立可见 projection owner 检查；BTW 活跃时 main callback 只更新 main in-flight state，不执行 terminal commit
- [x] 6.2 在 `src/app/btw-conversation-controller.ts` 为 side turn 维护独立 per-segment/reasoning/drain 状态；app 级共享 activity timer 每次只 commit 当前可见 owner
- [x] 6.3 进入/退出 BTW 与 resize 的 destructive replay 注入正确 owner 的 records、选定 boundary 前的 in-flight source 和 pending tail；关闭 BTW 丢弃 side queued/visible state且不影响 main
- [x] 6.4 在 `test/app/btw-conversation-controller.test.js` 与 main/controller tests 覆盖：后台 main 跨稳定边界不污染 BTW、退出恢复 main 最新 in-flight 投影、side Esc 丢弃已写行、迟到 token/tick 不推进任何 cursor

## 7. Reasoning 显示偏好

- [x] 7.1 `showReasoningSummary=false` 时禁止 reasoning terminal commit，允许沿用有界 transient footer preview，最终 summary record照常提交但不可见
- [x] 7.2 true→false 使用 destructive recovery 移除 in-flight reasoning projection；false→true 在同一次 destructive replay 中按当前视觉行边界重投影并同步 visible cursor，后续 drain 只追加新增 source
- [x] 7.3 增加运行中切换偏好的主会话与 BTW 测试，断言 transcript事实不变且当前 terminal owner 不泄漏 reasoning block

## 8. 文档与验证

- [x] 8.1 更新 `docs/tui-architecture.md`：terminal scrollback 与 transcript事实区分、source cursor、per-segment 生命周期、reasoning 视觉行边界、activity drain、destructive replay和projection owner
- [x] 8.2 运行 `openspec validate incremental-stream-commit --strict`
- [x] 8.3 依次运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 8.4 交互式手动验证：长正文不折叠、长 reasoning 尾行保守兜底、多个工具 segment顺序、首 tick 前完成、resize/theme切换、Esc/error partial、BTW前后台隔离（由用户操作）
