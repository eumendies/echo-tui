## Why

当前 `/resume` 和 `/reference` 的会话浏览都需要历史候选摘要与右侧预览。旧链路在打开 surface 前同步读取并重放当前项目的全部 session journal，耗时随历史会话正文总体积增长，并阻塞终端主线程。两个入口应共用轻量列表索引和按需预览能力，让左侧列表先显示、右侧预览异步加载，同时在确认后继续通过完整 journal replay 执行恢复或引用准备。

## What Changes

- 为每个项目维护 schemaVersion 1 的轻量 session index，记录 `/resume` 与 `/reference` 列表所需的 sessionId、创建/更新时间、消息数量、标题及 journal 指纹。
- journal 创建、追加或截断成功后更新对应 index 条目；journal 继续作为会话内容的唯一事实来源，index 可在缺失、损坏或过期时重建。
- `/resume` 与 `/reference` 打开时只读取项目 index 和轻量文件状态，不再为候选列表重放所有 session journal。
- 两个入口都先展示左侧列表，右侧预览仅在会话被选中并短暂停留后按需读取该 session，快速连续移动时不加载途经会话。
- 为异步预览增加 loading、失败、迟到结果隔离和跨入口共享的有界内存缓存；确认恢复或引用仍以选中 journal 的完整有效 replay 结果为准。
- 抽取共享 session browser 状态控制器和异步预览控制器，并让宽终端下的 resume surface 像 file picker 一样接近占满可用终端宽度。
- 旧项目没有可用 index 时允许一次性重建，并保证重建失败不会损坏 journal。

## Capabilities

### New Capabilities
- `resume-session-browser-performance`: 定义 `/resume` 与 `/reference` 基于项目级轻量索引打开历史会话列表、按需加载选中会话预览、处理异步导航及宽终端 surface 的用户可见行为。

### Modified Capabilities
- `transcript-journal-persistence`: 将历史会话摘要从“每次打开时重放全部 journal 派生”调整为由 journal 写入路径维护可验证、可重建的项目级索引，同时保持 journal 的事实来源、恢复容错和只读引用语义。

## Impact

- 影响 `src/persistence/transcript-store.ts`、transcript 类型和项目分区内的持久化文件布局。
- 影响 `TranscriptContext`、CommandHost transcript/reference ports、`/resume` 与 `/reference` handlers、共享 session browser 状态和预览控制器，以及 resume surface 的 loading/error 与宽度投影。
- 需要为 index 创建、更新、原子替换、损坏/过期重建，以及预览防抖、缓存和迟到结果隔离增加测试。
- 不引入第三方依赖，不改变 JSONL journal 格式，不改变 `/resume` 最终恢复内容或 `/reference` 最终引用素材。
