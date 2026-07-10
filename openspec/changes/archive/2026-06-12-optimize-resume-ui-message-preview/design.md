## Context

`/resume` 当前由 `ResumeCommandHandler` 读取当前 cwd 的 `TranscriptSessionMetadata[]`，再投影成通用 `select` command surface。该 surface 只能显示单列 option，最多 5 条 session，并用 `lastMessagePreview` 展示最后一条摘要。

目标 UI 来自已有终端历史浏览 demo 的视觉思路：左侧是历史 session 列表，右侧是选中 session 的消息预览。项目约束是继续使用现有 TUI footer 重绘、ANSI 渲染、统一 command session/runtime，不引入 alternate screen、第三方 TUI 库或 demo 的 raw key/render loop。

## Goals / Non-Goals

**Goals:**

- `/resume` 打开后在 footer command surface 区域显示两栏历史恢复面板。
- 左栏保留当前 session 窗口选择语义：按 `updatedAt` 倒序、最多 5 条可见、`Up/Down` 不循环移动。
- 右栏展示当前选中 session 最近几条 transcript record 的 role 和截断文本。
- 保持 `Enter` 恢复、`Esc` 取消、空状态、response lock 和恢复后 transcript 替换语义不变。
- 渲染层只消费 surface 快照，不主动读取持久化 session 或产生业务副作用。

**Non-Goals:**

- 不增加搜索、PageUp/PageDown、Home/End、vim keybind 或预览区滚动。
- 不改变 transcript session 文件格式，不迁移历史文件。
- 不改变 `/model`、`/skills manage` 等其他 `select`/`checkbox` surface 的视觉和语义。
- 不为恢复动作追加额外 transcript 记录或本地提示记录。

## Decisions

### 使用专用 `resume` command surface，而不是扩展通用 `select`

新增 `ResumeCommandSurface`，包含标题、左栏 session item、右栏 preview item、相对选中项和 dismiss hint。`renderCommandSurface` 根据 `kind: 'resume'` 分发到新的 footer renderer 模块。

这样可以让通用 `select` 继续保持简单单列语义，避免为一个特定命令引入左右栏、preview、边框等字段。替代方案是在 `SelectCommandSurface` 上增加 optional preview 字段，但这会让所有 select consumer 承担命令专属布局含义，后续维护成本更高。

### 在 command 层准备 preview 数据，renderer 只投影

`ResumeCommandHandler` 在启动和移动选择时构造完整 surface 快照：左栏展示当前窗口内 session，右栏展示当前选中 session 的最近消息摘要。renderer 不调用 `TranscriptStore`，不读取 session 文件。

这样符合当前 command host 边界：handler 通过 host 获取恢复所需数据，renderer 保持纯函数。替代方案是 renderer 根据 sessionId 延迟加载 preview，但这会把 IO 和业务知识泄露到渲染层。

### 通过 metadata preview seam 获取最近消息摘要

当前 `TranscriptSessionMetadata` 只有 `lastMessagePreview`。为了支持“最近几条消息”，需要给 `/resume` 可读的数据增加一个 bounded preview 字段，例如 `previewRecords` 或 `recentMessages`，每项只包含 role、text 和可选 createdAt。该字段由 transcript listing/load seam 从完整 `records[]` 派生，不要求改变磁盘 session 结构。

派生策略应从 session 尾部取最近若干条非空文本记录，做空白归一化和长度截断。工具记录、错误、本地提示等 role 可以展示 role 名称和文本摘要，不需要复用完整 transcript block renderer。

### 保留最多 5 条 session 的窗口逻辑

虽然两栏面板有更多垂直空间的诱惑，但现有规格和测试已经约束 `/resume` 一次最多显示 5 条 session。此次只提升选中项可辨识度，不扩大导航模型。

### 自适应宽度时优先保留核心信息

宽终端显示左/右两栏和边框；窄终端仍保持同一个 surface，但可以压缩列宽、减少 preview 文本宽度，必要时让右侧只显示少量预览行。所有行都必须遵守 `safeRenderWidth`，避免写满最后一列触发终端自动换行。

## Risks / Trade-offs

- [Risk] 增加 `TranscriptSessionMetadata` 字段可能影响测试 fixture 和调用点。→ Mitigation: 字段保持可选或在 fake store 中同步补齐，并让 renderer 对缺失 preview 回退到 `lastMessagePreview`。
- [Risk] 两栏边框和 ANSI 样式容易在中文、emoji、ANSI 嵌套时错位。→ Mitigation: 复用现有 `displayWidth`、`clampPlainText`、`padVisibleText`，新增针对中英文混排和窄宽度的 footer tests。
- [Risk] 列表 metadata 读取如果加载完整 session 并生成 preview，session 数量很多时会增加 `/resume` 打开成本。→ Mitigation: 只派生最近少量消息和短文本；当前 `listSessions` 已读取 session JSON 以计算 `messageCount` 和 `lastMessagePreview`，新增 bounded preview 不改变 IO 数量级。
- [Risk] spec 从 `select` 改为专用 surface 会影响依赖该断言的测试。→ Mitigation: 同步更新 OpenSpec、command tests、app tests 和 footer renderer tests，明确这是用户可见 UI 变更而非恢复语义变更。

## Migration Plan

无需数据迁移。已有 session 文件继续保存完整 `records[]`，新的 preview 数据在 listing 阶段从 records 派生。若实现需要回滚，可恢复 `/resume` 使用 `select` surface，并保留多余 metadata 字段为无害派生数据。

## Open Questions

- preview 最近消息数量固定为最多 5 条，和左侧 session 可见窗口数量一致；renderer 只做宽度截断，不维护独立滚动状态。
- 左栏 session 标题目前没有真实 title 字段，建议继续使用更新时间和消息数；是否需要从首条 user 消息派生标题可以作为后续独立优化。
