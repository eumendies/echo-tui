## 1. 并发分类与调度基础

- [x] 1.1 新增 provider-neutral 工具并发分类器，明确只读内置工具白名单、严格只读 Bash 动态判定以及 MCP、subagent、交互、状态、写入和未知工具的 exclusive 默认值
- [x] 1.2 在 agent loop 中增加直接扫描 tool calls 的具体辅助逻辑：收集并同时执行整个连续只读段，并在遇到 exclusive 调用时先等待当前并发读取；不得引入 `ToolWave` 或 wave planner 领域类型
- [x] 1.3 为分类器和顺序扫描逻辑增加单元测试，覆盖只读 Bash、低风险但非只读 Bash、混合 `R R W R`、连续写调用和未知工具

## 2. Agent loop 并行执行

- [x] 2.1 重构主 `agent-loop-runtime` 的多 tool call 循环，使整个连续只读段直接并行、exclusive 调用直接串行，并继续对每个调用应用 readonly policy、风险审批、todo、用户问题和 executor 边界
- [x] 2.2 对同时执行的连续只读调用按输入索引收集结果，等待已启动任务 settled，并按 provider 原始顺序向 record region 和 app callbacks 提交相邻 call/result pairs
- [x] 2.3 保持每个调用真实的 observation start/end 生命周期，处理单工具失败、外部 abort 和意外 rejection，确保中断并发读取不发布孤立 app transcript 记录或迟到 callback
- [x] 2.4 扩展 agent loop 测试，使用可控 promise 证明只读调用重叠、写调用形成屏障、结果提交顺序稳定、失败互不取消且 Esc/abort 能终止全部同时运行的任务
- [x] 2.5 移除固定并发上限与只读段分批循环，使用单次 all-settled 边界同时启动整个连续只读段，保持独占屏障和稳定提交语义
- [x] 2.6 更新 agent loop 测试，证明超过 4 个连续只读调用仍全部重叠执行且不存在固定大小的顺序子批次

## 3. 主 TUI 与 BTW 多工具 pending 状态

- [x] 3.1 将 `TurnContext` 的单一 pending tool call 改为按 call id 管理的有序多调用状态，并更新完成、失败、中断和 assistant turn 收尾清理逻辑
- [x] 3.2 更新 `assistant-turn-runner` callback 桥接，使同时执行的多个只读 call 均进入 pending，并在稳定 result 到达时取出正确 call、追加相邻 pair 且不覆盖其他 pending 调用
- [x] 3.3 将 BTW controller 的单一 pending tool 状态同步改为隔离的有序多调用状态，保持 side records、todo、compaction 和主会话互不污染
- [x] 3.4 增加 app/BTW controller 测试，覆盖多调用登记、原序完成、单个结果关联、整批清理、中断无 orphan record 和旧 turn 迟到 callback 隔离

## 4. Footer 与历史工具渲染

- [x] 4.1 扩展 `PendingState` 和 footer pending projector，按 provider 顺序复用现有专属 tool preview renderer 展示多个运行中调用
- [x] 4.2 为多工具 pending 增加 footer 行预算、safe width 和隐藏调用数量摘要，确保 composer、status line 和光标布局不被挤出
- [x] 4.3 保持连续只读调用全部完成后相邻 call/result pair 走现有 pair-aware 历史 renderer，并确保 pending 移除与历史 append 不重复显示
- [x] 4.4 增加 renderer/footer 测试，覆盖多个不同工具 preview、窄终端、高度截断、成功失败 pair、resize/destructive replay、BTW 投影和中断清理
- [x] 4.5 将两个及以上 pending 工具改为共享标题和单行工具摘要组成的 compact 分组列表；禁止回退到完整卡片堆叠，并保持单工具 pending 与完成历史样式不变
- [x] 4.6 增加 compact 分组 renderer/footer 测试，覆盖 provider 顺序、关键目标摘要、safe width、隐藏调用实际数量、单行预算和 resize 下稳定样式

## 5. Provider 多调用能力

- [x] 5.1 为 OpenAI Chat 普通带工具请求启用 parallel tool calls，保持 compaction 请求不携带 tools 或并行参数，并更新请求类型与 fixture
- [x] 5.2 验证 Codex 已有并行开关以及 OpenAI Responses 当前 SDK/兼容请求字段；在协议支持时显式启用 Responses 并行调用，否则记录并测试依赖其既有多 function-call 输出行为
- [x] 5.3 扩展 OpenAI Chat、Responses、Codex 和 Anthropic stream reader 测试，覆盖单 turn 多调用的参数分片组装、去重、call id 和 provider 顺序
- [x] 5.4 扩展各 transcript converter 测试，确认多个成功/失败 result 均以正确 call id 进入下一次 provider continuation

## 6. 集成验证

- [x] 6.1 运行 `npm run typecheck` 并修复类型或 callback 契约问题
- [x] 6.2 运行 `npm test`，确认主 TUI、BTW、headless、审批、用户问题、provider 和 transcript persistence 回归测试通过
- [x] 6.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 6.4 手工验证主 TUI 与 BTW 的并行只读调用、多 pending footer、resize、Esc 中断，以及写工具、审批、`ask_user_questions` 和 MCP 仍严格串行
