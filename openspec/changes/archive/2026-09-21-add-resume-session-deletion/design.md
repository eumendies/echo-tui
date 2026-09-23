## Context

`/resume` 复用双栏会话浏览器：左栏来自当前 cwd 的轻量 session index，右栏按需异步读取 journal 预览；`Enter` 会通过正式加载路径恢复选中会话。持久化 session 的事实来源是 `sessions/<sessionId>.jsonl`，`index.json` 是可重建缓存，model/effort settings 则保存为同目录的 `<sessionId>.settings.json` sidecar。

删除涉及命令交互、异步预览、当前 session 写入指针、journal/index 和 sidecar 多个边界。项目保持 Node.js 内置文件系统、ANSI TUI 与同步持久化模型，不引入依赖或后台任务。

## Goals / Non-Goals

**Goals:**

- 让用户在 `/resume` 内以 `d` 删除选中的历史 session，并通过 `Enter`/`Esc` 完成明确确认或取消。
- 确保未确认、取消、目标无效或删除失败时不会删除 journal。
- 将成功删除的 session 从 JSONL、可见 index 和 settings sidecar 中移除，并让列表立即反映结果。
- 保护当前正在使用的持久化 session，且不让异步预览结果破坏确认或删除后的 surface。

**Non-Goals:**

- 不提供批量删除、按名称或 session id 输入删除、删除后恢复、回收站或跨 cwd 管理。
- 不改变 `/reference` 的候选或删除能力，不允许 `--once` 管理交互式 session。
- 不删除 transcript 以外的工作区文件、工具产物或其他 session 的数据。

## Decisions

### 1. 用 `d` 触发独立确认态，而非直接删除

`/resume` 活跃时，`d` 针对当前选中项触发删除意图；不论焦点在列表还是预览，选中项保持唯一。命令 session data 保存待删除的 session 快照，surface 切换到既有 `confirm` 类型，内容展示会话标题、更新时间和不可恢复提示。`Enter` 只确认该快照，`Esc` 放弃并回到浏览器。

选择复用通用确认 surface，而不是在双栏 renderer 中内嵌按钮，以保持现有 Enter/Esc 输入路由和 footer 渲染机制。备选方案是按下 `d` 后直接删除；它无法满足不可逆操作的确认要求。另一方案是新增 `/delete-session` 命令；它会脱离用户已经选中并预览的上下文，且需要额外输入目标标识。

### 2. 当前 session 在进入确认前被拒绝，并在删除 API 再次防御

命令端通过 transcript port 获取当前持久化 session id；若选中项正是当前 session，保留浏览器并展示稳定提示，不进入确认。删除 port/AppContext 仍须再次拒绝相同目标，避免其他调用路径或竞态删除仍在内存中持有写入 reference 的 journal。

不允许“删除当前 session 后保留内存 transcript”：那会导致后续追加创建不完整的新 journal，造成显示、上下文和恢复内容不一致。也不将删除当前 session 等同于 `/clear`，因为两者的用户意图和副作用不同。

### 3. journal 是删除提交点；index 与 sidecar 采用可恢复清理

删除操作只接收由当前列表提供的 session id，并验证其属于当前 cwd、不是当前 session 且对应 journal 存在。成功移除 `.jsonl` 即视为删除提交；随后以既有临时文件加 rename 方式移除 index 摘要，并尽力删除同 id 的 settings sidecar。

跨 journal、index 与 sidecar 不存在原子多文件事务。若 journal 删除前失败，操作返回失败且不改动其他文件；若 journal 已删除而 index 写入失败，列表枚举必须以真实 `.jsonl` 集合剔除孤立 index，并在后续写入时自愈。sidecar 清理失败不会复活会话，也不影响删除成功结果；孤立 sidecar 按既有规则不可恢复。

### 4. 删除前失效预览，完成后从存储重建浏览状态

进入确认态立即使预览 controller 的 generation 失效，禁止在途异步回调把 generic confirm surface 改回 resume surface。取消确认时，若原选中项仍存在，浏览器为该项重新进入 loading 并按现有机制加载预览，同时恢复进入确认前的焦点和预览滚动偏移；若目标已不存在则按安全降级状态重建。确认成功时重新调用列表查询，以新快照创建数据：选中索引钳制到仍存在的邻项、焦点回到列表；仍有候选时只加载新的选中项预览，空列表显示既有空状态。

不在 command handler 内按本地数组直接 splice 作为事实来源，因为外部文件变化、index 自愈和持久化失败均应通过存储查询统一反映。删除目标对应的预览缓存必须失效，避免未来 session 误用旧缓存。

### 5. 通过结构化端口结果传播可展示失败原因

transcript store/context/app/command port 增加受控删除方法，并返回区分 `current`、`missing`、`failed` 的结构化结果；命令层将其映射为稳定中文提示，不直接暴露文件路径或底层异常。session model settings store 增加删除 sidecar 的尽力方法，由 AppContext 在 journal 删除成功后编排调用。

相较于只返回 boolean，结构化结果能区分安全拒绝和 I/O 失败，也能让测试锁定无副作用边界；相较于由 `/resume` 直接访问文件系统，它保留 cwd 分区、当前 session 和 sidecar 生命周期的应用层约束。

## Risks / Trade-offs

- [确认期间有预览请求完成] → 进入确认时增加 controller generation 并仅允许 active resume 浏览状态接收回调。
- [journal 已删除但 index 更新失败] → 将 journal 作为事实来源，现有枚举的孤立 index 检测和原子重写负责自愈。
- [settings sidecar 删除失败] → 返回的会话删除仍以 journal 为准；sidecar 保持不可枚举，后续可由人工或未来清理机制处理。
- [外部进程在确认后先删除目标] → 确认时重新验证目标；返回 `missing`，不删除其他文件，浏览器重新查询。
- [删除后无候选] → 不启动预览加载，使用已有可关闭空状态，避免访问不存在的选中项。

## Migration Plan

不需要数据迁移。升级前已有的 JSONL、index 和 settings sidecar 继续可读；只有用户在确认删除后才会移除对应文件。回滚代码不会重建已确认删除的 journal，因此删除确认文案必须明确不可恢复；未删除的历史数据不受影响。

## Open Questions

无。当前 session 保护、`d` 快捷键和 `Enter`/`Esc` 确认语义作为本变更的固定范围。
