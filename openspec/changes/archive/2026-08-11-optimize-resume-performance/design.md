## Context

旧的 `TranscriptStore.listSessions()` 会枚举当前项目的全部 `.jsonl`，同步读取全文并调用 `replayTranscriptJournal()`，随后派生标题、消息数和最近 20 条预览。`ResumeCommandHandler.start()` 与 `ReferenceCommandHandler.start()` 必须等待该调用结束才能打开 surface，因此主线程阻塞时间与全部历史 journal 的总体积线性相关；当前仓库对应项目分区已有约 58.5 MB journal，单文件最大约 41.4 MB。

历史会话 surface 实际有两个不同的数据需求：左栏只需要可排序的 session 摘要，右栏只需要当前选中 session 的有界预览。设计需要拆开这两个读取路径，让 `/resume` 与 `/reference` 共用摘要、缓存和异步预览生命周期，同时保持 JSONL journal 为唯一事实来源、尾部修复和中间损坏判定不变。

## Goals / Non-Goals

**Goals:**

- 正常情况下打开 `/resume` 或 `/reference` 不为候选列表读取或 replay 任意 session journal 正文。
- 使用项目级轻量 index 一次性提供左栏所需的全部 session 摘要。
- 在首帧 surface 已显示后，仅为当前稳定选中项按需加载右栏预览，并允许两个入口共享有界缓存。
- 快速导航时避免读取途经 session，并隔离关闭、切换或重新打开命令后的迟到结果。
- index 缺失、损坏、过期或写入中断时可从 journal 安全重建，不影响 journal 恢复语义。

**Non-Goals:**

- 不改变 JSONL journal schema、记录内容或完整 session 恢复结果。
- 不引入数据库、第三方索引库、worker thread 或 alternate screen。
- 不要求旧项目升级后的第一次历史会话列表查询也完全无重建成本。
- 不改变 `/reference` 确认后的完整只读 replay、pending 引用和发送前总结语义。
- 不把完整 replay 后的 session 长期缓存在 command surface 或 command session data 中。

## Decisions

### 1. 每个项目使用一个轻量 `sessions/index.json`

index 使用 `schemaVersion: 1` 和 session 条目数组。条目包含 `sessionId`、`createdAt`、`updatedAt`、`cwd`、`messageCount`、从最终 records 第一条用户消息派生的 `title`，以及用于校验缓存的 journal `size`、`mtimeMs`；`sourcePath` 由目录和 sessionId 计算，预览正文不进入 index。schema 1 尚未发布，因此实现期间增加 `title` 直接纳入首版 schema，不提前消耗版本号。

选择项目级 index 而不是逐 session metadata sidecar，是因为 `/resume` 与 `/reference` 首帧都需要一次获得总数、排序和左栏窗口；单文件可通过一次小文件读取完成，且最小条目不会产生明显的重写体积。选择 index 而不是从文件名和 mtime 推断，是因为现有 sessionId 只表达创建时间，无法可靠提供当前消息数、标题和语义更新时间。

### 2. journal 是事实来源，index 是可验证、可重建投影

每次 journal 创建或追加成功后，`TranscriptContext` 使用当前最终 records 和 journal reference 生成该 session 的列表摘要，store 在读取最新 index 后替换单个条目，并通过临时文件加原子 rename 提交。journal 写入先于 index；index 写入失败不得回滚或判定 journal 持久化失败。

`listSessionSummaries()` 读取 index 后仍会执行轻量目录枚举和 `stat`：

- journal 与 index 条目的 `size`、`mtimeMs` 匹配时直接使用 index，禁止读取正文；
- journal 缺少条目、条目无效或指纹不匹配时，只 replay 对应 journal 并修复该条目；
- index 中不存在对应 journal 的条目会被移除；
- index 整体缺失或损坏时 replay 当前目录的全部 journal，并原子重建 index；
- replay 判定为无效的 journal 不进入列表。

这使正常路径与正文总体积无关，同时保持现有“中间损坏 session 不可恢复”的契约。旧项目第一次打开时允许同步完成一次重建，之后进入快速路径。

### 3. 不为 index 增加跨进程锁

首版采用“读取最新 index、替换单项、原子 rename”的 best-effort 更新，不增加 lockfile。两个进程并发写不同 session 时可能发生可恢复的丢失更新，但下一次列表会通过目录枚举和 journal 指纹发现并重建缺失或过期条目；任何竞争都不会修改或删除 journal 内容。

这是以短暂 index 陈旧换取更小实现复杂度。若后续观察到同 cwd 多进程频繁竞争，再独立增加短临界区锁，而不是在本次性能优化中提前引入锁恢复协议。

### 4. 使用通用列表摘要和预览 API

旧的 `TranscriptSessionMetadata` 同时携带列表字段、sourcePath 和 `previewRecords`，迫使列表查询准备所有预览。本次删除该复合类型和旧 `listSessions()`，改为通用路径：

- `listSessionSummaries()`：同步返回项目 index 中的 `TranscriptSessionSummary` 轻量列表项；
- `loadSessionPreview(candidate)`：异步只读 replay 一个候选 journal，返回 `TranscriptSessionPreview` 有界 preview records；
- `loadSession(sessionId)`：保持现有完整恢复行为。
- `loadReferenceSession(candidate)`：确认引用时完整只读 replay journal，并根据当前 cwd 与 sessionId 生成 sourcePath。

预览加载使用 read-only replay，不修复、截断或改写源 journal。返回 command 层前只保留 renderer 所需的最近 20 条有界文本，完整 records 不写入 surface/data。

### 5. 两个历史会话 surface 的首帧与预览加载解耦

`ResumeCommandHandler.start()` 与 `ReferenceCommandHandler.start()` 读取 index、立即打开包含左栏和 `loading` 右栏的 surface，并在当前同步启动结束后调度首个选中项预览。首次渲染不得等待预览 Promise。

列表选择改变时立即更新左栏和 loading 状态，并以短延迟防抖后加载最终稳定项。每次命令打开和每次选择都生成请求 generation；Promise 完成时只有 generation、sessionId 和当前 active command session 都匹配才能更新 surface。Esc、Enter、命令关闭或重新打开会使旧 generation 失效。

预览状态明确区分 `loading`、`ready` 和 `error`。单个 journal 预览失败只影响右栏，不移除左栏候选；Resume 的 Enter 仍通过正式 `loadSession()` 再次验证并决定是否恢复，Reference 的 Enter 则通过完整只读 replay 创建 pending 引用。

共享纯状态逻辑位于 `src/commands/session/session-browser.ts`，负责分页、焦点、滚动边界、导航和 surface 投影；共享异步逻辑位于 `src/commands/session/session-browser-preview-controller.ts`，负责防抖、generation、active command/sessionId 校验、错误投影和重绘。业务 handlers 只提供列表标签、预览 loader 和 Enter 动作。

### 6. 在 TranscriptContext 中共享有界预览缓存

`TranscriptContext` 为本次进程维护最多 5 项的小型 LRU，供 transcript 与 reference command ports 共用。key 为 `cwd + sessionId + size + mtimeMs`，value 仅包含有界 preview records。缓存命中时可以直接更新右栏；fingerprint 改变自动形成新 key。缓存不保存完整 `LoadedTranscriptSession`，避免长会话占用大量内存，也避免 command surface clone 扩大。候选 cwd 与当前 cwd 不一致或 loader 返回不同 sessionId 时不得写入缓存。

因此用户预览后按 Enter 可能再次 replay 该 journal；本次优先保证列表打开和导航成本可控，完整恢复缓存可在独立性能数据支持后再设计。

### 7. Resume Surface 在宽终端接近占满可用宽度

Resume 与 Reference 继续复用 `kind: 'resume'` 的双栏 renderer。为避免宽终端下固定 118 列上限留下大块空白，box width 与 file picker 保持一致：安全宽度达到 64 列时保留 4 列水平边距，否则使用完整安全宽度。窄终端仍通过 `safeRenderWidth()` 和现有左右栏最小空间规则避免写入最后一列或溢出。

## Risks / Trade-offs

- [旧项目第一次打开仍需 replay 全部 journal] → 将其限定为一次性迁移；成功后原子写 index，后续正常路径不再扫描正文。
- [journal 成功但 index 更新失败或进程崩溃] → journal 优先写入并保持事实来源；下次通过 size/mtime 自动识别并重建单项。
- [项目级 index 并发写发生丢失更新] → 原子 rename 防止半文件，目录与 fingerprint 对账恢复缺失项；本次不引入跨进程锁。
- [异步读取完成后的 JSON replay 仍会短暂占用主线程] → 首帧先显示，导航防抖避免重复工作；worker thread 和流式 replay 留作后续优化。
- [预览与 Enter 恢复/引用重复读取同一 journal] → 只缓存有界预览以控制内存；接受确认时再次验证事实来源的成本。
- [mtime 精度或外部同尺寸改写导致错误命中] → 同时校验 size 与 mtime；正式恢复始终 replay journal，不信任 index 正文正确性。

## Migration Plan

1. 增加 index schema、读写、原子替换、对账和从 journal 重建能力，但不改变现有 journal 文件。
2. 将 journal 创建、追加和截断路径接入 index 单项更新，使新活动 session 持续具备有效条目。
3. 将 `/resume` 与 `/reference` 列表切换到 index 摘要，并加入共享懒加载预览状态机、迟到隔离和有界缓存。
4. 旧项目首次调用列表时自动构建 `sessions/index.json`；回滚旧版本时该额外文件会被忽略，journal 无需迁移或降级。

## Open Questions

- 防抖时间固定为 120ms，并通过共享 controller 测试覆盖；若手动验证感觉迟滞，可在不改变持久化设计的前提下调整。
- 若实际项目出现数万 session，最小 index 的整体重写成本可能需要进一步改为分段或日志式索引；当前规模不为该假设增加复杂度。
