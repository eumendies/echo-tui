# 压缩后的 transcript 内存与历史

## 用户可见行为

自动压缩和手动 `/compact` 成功后，摘要替代较早历史进入模型上下文，应用和对应 Agent 运行记录区只保留当前摘要与边界之后的活跃记录。已压缩原始对象、正文和附件不再由这些记录区或本轮输入快照长期持有；没有成功采纳摘要时不裁剪。交互式主会话先把压缩状态和提示作为一个 batch 写入 journal，再释放旧前缀；写盘失败不会提前裁剪。

完整原文仍保存在既有 JSONL journal，默认位置为 `~/.echo/echo_tui/projects/<cwd-hash>/sessions/<session-id>.jsonl`。压缩不删除原文、不迁移日志格式、不新增配置或专用历史读取工具。模型上下文中有 journal 源路径时，摘要消息附带 `source_file`，模型需要精确细节时可使用现有 `read_files` 分页回读。

压缩本身不主动清屏或清除终端 scrollback。resize 触发的破坏性重绘、主题切换、session 恢复，以及退出 BTW/子 Agent 视图后，主会话只显示压缩历史提示与活跃记录，不从 journal 重放旧原文，也不展开摘要全文。展示提示不额外写入 transcript，同一提示不重复展示。原有 resize 策略仍可能清除终端 scrollback，不能把 scrollback 当作可靠历史存储。

## 完整历史操作保持原有语义

| 操作 | 压缩后的行为 |
| --- | --- |
| `/resume` | 可全量重放 journal；安装到主会话的常驻状态只包含目标摘要与活跃后缀。无压缩时仍安装完整记录。 |
| `/fork` | 从完整有效历史建立自包含的新 journal，保留当前压缩、todo 和 change history；新分支恢复不依赖源 journal，驻留区仍是活跃后缀。分支共享工作目录，不隔离文件改动。 |
| `/copy` | 仍可选择并复制已压缩 user/assistant 消息的原文，保持多选和顺序语义；关闭面板后释放临时加载的消息集合。 |
| `/undo` | checkpoint 使用完整历史位置；目标仍在驻留区时直接截短，不重放 journal。跨压缩边界时先读取所需历史，再执行既有文件回退/日志提交流程，安装目标摘要及其活跃区。没有目标摘要时可重新驻留目标完整记录，不把全局边界钳到当前数组长度。 |
| 历史引用、预览 | 需要旧原文时按需读 journal，不把完整历史重新装入主会话；预览缓存只保留展示文本。 |
| 子 Agent 回看 | 打开时只读一次完整历史，仅保留过程记录；后续主会话事件增量更新索引和当前 body，计时刷新、resize 和 run 切换不再重放 journal。关闭窗口释放过程记录。 |
| BTW | 冻结打开时的主会话摘要与活跃后缀，后续主会话压缩不改变已冻结输入；旁路显示计数不使用主历史偏移。 |

完整恢复、fork/copy、跨边界 Undo 和历史回看可能临时全量加载原文，**这些操作的内存峰值是接受的取舍**，不是常驻 transcript 的保证。操作结束后不新增永久完整历史缓存。`/clear` 重置记录、驻留起点和摘要并解绑旧 session，但不删除旧 journal。

完整历史读取失败（journal 缺失、被外部改写或 I/O 错误）时，展示类路径降级而不是中断会话：`/copy` 显示不可用提示，Ctrl+O 不打开窗口，最近模式回退 `normal`，自动审批回退人工审批；`/fork` 与跨边界 `/undo` 直接返回失败，不改写文件、不切换会话、不安装错误的后缀。

## 架构不变量与范围

`TranscriptContext` 的驻留数组是完整有效历史的连续后缀：

```text
完整有效记录数 = baseRecordIndex + records.length
全局位置 = baseRecordIndex + 内存下标
有摘要：baseRecordIndex = compaction.activeStartIndex
无摘要：baseRecordIndex = 0
```

`baseRecordIndex` 是运行时派生状态，不写进 journal。压缩边界、Undo checkpoint 和审批关联使用完整历史位置；journal seq 是操作序号，不能当作记录位置。日常追加、Agent 输入快照和主会话重绘不为补齐前缀而重放完整日志，完整读取仅留给确实需要原文的历史操作。

Agent 输入的所有权转移只适用于独立记录数组，摘要和起点由 runtime 的局部状态及采纳回调推进，不回写输入元数据。应用恢复接口只返回成功标志；fork 直接同步序列化完整有效历史，不再额外深拷贝整份记录。主会话渲染缓存由 coordinator 每帧统一同步，投影记录只通过当前 owner 的 `records` 传入。

本变更仅消除已压缩 transcript 的长期驻留，**不承诺整个进程严格有界**。不改变压缩阈值、工具配对保护、图片预算，也不引入通用字节上限或分页数据库。单次输入/模型响应、尚未压缩的活跃区、并发、Undo 文件快照、输入历史、独立 usage/debug 状态、终端 scrollback，以及 shell-local 的无界输出捕获策略均不在本次限制范围内。无 journal 的 headless/子 Agent 压缩采用同样的偏移规则，不为此新建可恢复 session。

## 内存验证记录与边界

本变更在开发期间用一次性 `--expose-gc` 压测脚本验证过驻留语义：脚本从 `dist/src/` 导入真实 `TranscriptContext` 与 `createTranscriptStore`，在系统临时目录写入真实 session journal，不调用 provider、不修改用户数据。该脚本不在 CI 中运行，也不在 `tsc` 的 include 范围内（`npm run typecheck` 与 `node --check` 都覆盖不到），留在仓库里只会随接口改名静默失效，因此记录结果后已移除。

- 负载：连续 48 批、每批 128 条独立随机的 8 KiB 正文，逐批 `applyCompaction` 并固定保留最近 16 条正文与 1 条提示；每批断言驻留范围、顺序、正文长度、完整计数和全局压缩边界，采样前退出写入函数并让出事件循环，只累计数字样本与流式 SHA-256。
- 观测结果：6192 条有效历史、48.32 MiB journal、常驻后缀固定 17 条；跳过前 4 批 warmup 后 GC heap 为 4.57–4.70 MiB（首尾差 0.13 MiB，斜率约 2 KiB/批）。末尾唯一一次完整回读校验了全部原文字段、顺序与累计 SHA-256，回读期间临时分配约 266 MiB，释放后回到 4.75 MiB。

这些是观测值，不是全进程预算或固定阈值承诺，也不作为回归门禁；它只覆盖真实 transcript context 的重复采纳与持久化路径，**不等于所有内存来源有界**，不替代自动摘要、provider/runtime 引用释放、Undo、fork/copy、渲染及 TUI 流程的测试和手验。
