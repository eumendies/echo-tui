## 1. 驻留区与完整历史位置

- [x] 1.1 为 transcript/Agent 输入建立驻留起点与完整记录数语义，审计 records.length、activeStartIndex、transcriptStartIndex 和审批关联位置，保持 journal schema 不变。
- [x] 1.2 改造 TranscriptContext 的追加、清空、摘要更新和 Agent session 快照，只保存/复制活跃区；日常摘要更新不得 replay 完整 journal。
- [x] 1.3 增加位置转换、总数、标题、notice 追加与 clear 的单元/controller 测试。

## 2. 压缩采纳与引用释放

- [x] 2.1 让 runCompaction 接收驻留起点、计算局部边界并返回完整历史位置，保持原生 provider 投影、配对保护、图片预算和纯函数语义。
- [x] 2.2 自动压缩在 compaction/notice batch 成功写入后同步裁剪应用和 runtime，解除本轮 session 输入及闭包对旧前缀的引用；压缩后失效旧 usage 锚点。
- [x] 2.3 手动 /compact、子 Agent 和 headless 压缩共享偏移语义，适配 BTW 打开时的摘要/活跃区冻结及旁路独立计数。
- [x] 2.4 测试同一 run 连续压缩、无有效边界、空摘要、异常、采纳前取消、持久化失败与提交后中断；验证近期工具/extension 不丢失或重复切片。

## 3. 恢复、Undo 与完整历史操作

- [x] 3.1 恢复旧 session 后只安装目标摘要和活跃后缀，避免返回值或应用字段长期保留完整 replay records。
- [x] 3.2 使用完整历史位置创建 checkpoint，跨边界 Undo 先准备必要历史，成功后安装目标活跃区；保持既有文件恢复及单个 journal batch 语义。
- [x] 3.3 适配 fork、copy、reference、resume 预览、历史子 Agent 回看及审批查询：必要时临时读完整 journal，不把驻留后缀冒充完整历史，关闭操作后释放新引入的原始记录持有者。
- [x] 3.4 测试恢复含附件/extension 的压缩 session、连续 Undo、跨边界读取失败、Undo 后追加/压缩，以及 fork 独立恢复与失败不切换源会话。
- [x] 3.5 测试 copy 旧消息原文、多选顺序、历史 run 回看、已逐出审批事实与 BTW 快照隔离；确认不会向主会话重新装入已压缩前缀。

## 4. 活跃区重绘

- [x] 4.1 给主会话重绘提供当前 compaction/驻留起点，展示压缩历史提示及活跃记录；避免重复提示或为 UI 提示新增 transcript record。
- [x] 4.2 清理或重建 renderer 中旧记录引用及子 Agent 增量身份状态，保持当前活动调用和 footer/streaming 生命周期正确。
- [x] 4.3 测试压缩时不主动清 scrollback、resize/主题/恢复只重绘活跃区、退出 BTW/历史视图恢复主投影，以及无 compaction 时行为不变。

## 5. 验证与文档

- [x] 5.1 用一次性 `--expose-gc` 压测验证固定大小活跃后缀和多次成功压缩后的 GC heap 趋势；不使用脆弱的精确 RSS 断言，不给生产代码添加测试专用分支。脚本不在 CI 与 `tsc` include 范围内，记录结果后移除，避免随接口改名静默失效。
- [x] 5.2 更新用户/架构文档，说明已压缩原文仍在 journal、重绘显示活跃区，以及全量历史操作的临时峰值和其他内存增长来源不在本次范围内。
- [x] 5.3 按顺序执行 npm run typecheck、npm test、find bin src test scripts -name '*.js' -exec node --check {} \;，并验证 OpenSpec。
- [x] 5.4 完成针对性 TUI 手验：流式响应中自动压缩、手动 /compact、resize/主题切换、工具/审批、Esc 中断、resume/copy/fork/连续 undo、BTW/子 Agent 回看和终端退出清理；验证 fake headless 工具 continuation 的偏移与取消行为。

## 6. Review 收敛

- [x] 6.1 子 Agent 回看改为打开时单次完整读取、打开期间按主会话批次增量更新、关闭释放；覆盖 timer/resize/run 切换及 BTW 批次隔离。
- [x] 6.2 普通 Undo 直接截短驻留区，首条用户索引用于标题有效性判断；跨边界继续先预读再恢复文件，覆盖首条标题保留与重置。
- [x] 6.3 应用恢复接口只返回成功标志，删除返回值副本及 fork 的整份防御性深拷贝。
- [x] 6.4 删除仅测试使用的 setCompaction 和待写摘要状态，采纳时直接将摘要与 notice 合并提交，保留失败不修改已安装及其他待写状态的保证。
- [x] 6.5 coordinator 统一同步主会话渲染缓存，移除可选兜底和重复同步；投影状态不再携带第二个 records 来源，主/其他视图增量状态仍隔离。
- [x] 6.6 runtime 仅维护局部起点和摘要，通过 callback 通知应用；保留 records 数组转移裁剪和默认不修改 caller 的语义，不再回写 session 元数据。
- [x] 6.7 更新文档并重新按顺序完成类型检查、完整测试、JS 语法检查及 OpenSpec strict 校验，复跑内存验证并保留真实 PTY 阻塞说明。

## 7. 验证记录

- 首轮类型检查、完整测试、JS 语法检查及 OpenSpec strict 校验均通过；完整测试共 2141 项，2112 通过、29 跳过、0 失败。
- 一次性 `--expose-gc` 压测脚本（已按 5.1 移除）通过：48 次压缩、6192 条有效历史、48.32 MiB journal，常驻后缀固定 17 条；warmup 后 GC heap 为 4.43–4.56 MiB。完整回读后释放到 4.61 MiB；这些是观测值，不是全进程预算或固定阈值承诺。
- 隔离 HOME 的真实 `npm start` 构建/启动及管道 Ctrl+D 退出通过；fake `--once` 非 TTY 冒烟通过，无 ANSI 输出。
- 5.4 尚未完成：当前沙箱的 Python/libc openpty、`/dev/ptmx` 及系统 `script` 均返回 EPERM，无法创建真实 PTY。管道冒烟不视为 raw-mode、resize 或交互界面的验证，须在允许 PTY 的环境继续执行。
- Review 修复后重新按顺序通过类型检查、完整测试及 JS 语法检查，OpenSpec strict 和 diff 检查通过；完整测试共 2149 项，2120 通过、29 跳过、0 失败。主 app renderer 测试替身已补齐必需同步协议，BTW/runtime 回归通过采纳回调而非输入元数据回写验证状态。
- Review 后内存复验通过：48 次压缩、6192 条有效历史、48.32 MiB journal、驻留 17 条，warmup 后 GC heap 4.42–4.56 MiB；完整回读暂时分配至约 266.19 MiB，释放后 GC heap 4.61 MiB，SHA-256 完整性校验通过。日志：`/tmp/echo-review-fixes-memory.log`。
- Review 后隔离 HOME/config 的 `npm start` 管道 Ctrl+D 退出 0，fake `--once` 非 TTY 退出 0 且无 ANSI。重新检查 `os.openpty()` 仍返回 errno 1 / EPERM，5.4 继续保持未完成。完整测试日志：`/tmp/echo-review-fixes-full-test.log`；冒烟结果：`/tmp/echo-review-fixes-smoke-results.json`。
- 二轮 review 收敛：完整历史读取统一返回 `null`（`getCompleteRecords`），`/copy`、Ctrl+O、最近模式查询和自动审批四处降级不再抛出到输入路径；`restoreToBoundary` 改为显式要求跨边界完整历史并删除隐式回读兜底；`applyCompaction` 越界边界保留显式失败并补直连测试；压缩提示判定收敛到 `isCompactionSummaryNotice`/`createCompactionSummaryNoticeText`，渲染层不再复制文案正则；删除死代码 `collectParallelSubagentRunIds`、`rebuildSubagentAppendState` 的重复身份扫描与冗余 `Boolean`；`getRecords` 收敛为 `getResidentRecords` 且驻留数组改为私有。类型检查、完整测试（2157 项，2128 通过、29 跳过、0 失败）与 JS 语法检查通过；5.4 仍待允许 PTY 的环境完成。
- 三轮 review：删除一次性内存验证脚本 `scripts/verify-compacted-transcript-memory.js`。它不在 CI 中运行、也不在 `tsc` include 范围内，接口改名不会触发任何检查，保留即随实现漂移而失效；结论与观测数字保留在本文档与 `docs/compacted-transcript-memory.md`，用户文档不再提供已不存在的运行命令。
