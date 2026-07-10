## Context

当前 TUI 已经通过统一 slash command runtime 和 footer command surface 承载 `/resume`、`/undo`、`/config` 等本地交互。`/undo` 在 assistant loop 开始时创建 change checkpoint，受控 `apply_patch` 写盘前记录 before snapshot，写盘后标记 `created` / `updated`，并在写入型 bash 后把 checkpoint 标记为 invalid 且丢弃更早历史。

`/diff` 需要解决两个问题：Git 仓库内应展示真实工作区 diff；非 Git 或 git 不可用时，应尽量基于受控编辑记录展示差异，同时明确告知该 fallback 可能不完整。用户已经确认第一版交互只需要方向键，不需要 hjkl、PageUp/PageDown、跳 hunk 或手动切 layout。

## Goals / Non-Goals

**Goals:**
- 提供 `/diff` 本地 slash command，在当前 TUI 内查看文件 diff，不触发 assistant turn，不追加 transcript。
- Git 可用且当前目录属于 Git worktree 时，优先展示 Git 工作区真实 diff。
- Git 不可用、非 Git worktree 或 Git diff 读取失败时，使用受控 `apply_patch` change history 生成 fallback diff，并展示完整性提示。
- 使 fallback history 可序列化并随当前 transcript session 持久化，`/resume` 后仍能查看受控编辑 diff，且 `/undo` 可基于该 history 跨进程恢复。
- 复用现有 footer surface 机制，不切换 alternate screen，不引入第三方 TUI 库。
- diff 详情宽屏自动 side-by-side，窄屏自动 unified；用户不需要手动切换布局。

**Non-Goals:**
- 不让 `/diff` 编辑文件、stage 文件、checkout 文件或执行任何 Git 写操作。
- 不让 fallback diff 追踪手动编辑、不可追踪 shell 写入、外部进程写入或 Git index 状态。
- 不支持 hjkl、PageUp/PageDown、跳 hunk、手动 layout toggle 或 diff 内搜索。
- 不支持二进制 diff、mode-only diff、submodule diff 或外部 diff driver。

## Decisions

### 1. Git source 优先，history source 只做 fallback

`/diff` 通过 `CommandHost.diff` 读取 diff source。source resolution 顺序为：

1. 使用 `spawn` / `execFile` 以 argv 形式执行只读 Git 命令，确认当前目录在 worktree 内。
2. Git source 成功时，解析 Git unified diff 并作为唯一展示来源。
3. Git 不可用、当前目录不是 worktree 或 Git source 失败时，使用 persisted change history fallback。

不通过 `run_bash_command` tool 获取 Git diff，因为 slash command 不应污染 transcript、触发工具授权或影响 undo invalid 逻辑。Git 命令必须禁用 external diff，例如使用 `--no-ext-diff --no-color`，避免执行用户配置的外部程序。

替代方案是始终优先用 history。这个方案在 Git 仓库里会漏掉手动编辑、staged 状态、删除和重命名等真实工作区事实，不适合作为主路径。

### 2. 持久化同一份 change history

保留 `ChangeHistoryContext` 作为唯一的文件变更历史上下文。它持有同一份 change checkpoint 栈，同时服务 `/undo` 执行和 `/diff` fallback 展示：

- `/undo` 使用 ready checkpoint 的 transcript/compaction 边界和 before snapshot 执行强制恢复。
- `/diff` fallback 使用同一份 history 中最近 invalid 之后的 ready checkpoint 生成文件差异。

`TranscriptSession` 增加可选 `changeHistory` 字段，内容必须保持 JSON 可序列化。`TranscriptStore` 保存和加载该字段；不保留旧数据兼容。`/resume` 加载 session 后恢复完整 change history，因此 `/diff` fallback 和 `/undo` 都可以继续使用该历史。

替代方案是维持独立 diff history。这个方案会产生两套 checkpoint 模型，和 `/undo` 的真实文件恢复语义重复，增加心智负担。

### 3. invalid 仍然清空更早 history，并作为 fallback 完整性边界

写入型 bash 或其他不可追踪写入会使当前 checkpoint invalid。由于 invalid 之前的 history 不能被 `/undo` 或 fallback `/diff` 安全使用，实现上可以继续丢弃 invalid 之前的历史，并保留 invalid marker 作为提示来源。

fallback `/diff` 只聚合最近 invalid 之后的 ready history entries。若存在 invalid marker，surface SHALL 显示“已遇到不可追踪写入边界，仅展示边界之后的 apply_patch 记录”或等价提示。

替代方案是保留 invalid 之前的历史但查询时过滤。这个模型可解释性更强，但当前没有功能会使用这些历史，持久化后反而增加数据体积和误读风险。

### 4. fallback diff 使用 before snapshot 到当前磁盘状态的比较

history fallback 不直接展示原始 `apply_patch` 文本，也不简单重放 apply_patch result metadata。它应按文件折叠最近 invalid 之后的 entries：同一文件使用最早 before snapshot 作为 old side，读取当前磁盘状态作为 new side，再生成 diff。

这样可以覆盖同一进程或恢复会话后“多次 apply_patch 修改同一文件”的最终差异。若当前文件已不存在，则生成 deleted diff；若 before snapshot 不存在且当前文件存在，则生成 added diff；若当前文件不可读、非普通文件、超出文本限制或包含二进制内容，则该文件在 fallback source 中跳过并在 notice 中说明。

实现上可以用项目内置的轻量 line diff 算法生成 `DiffFile` 模型，不引入第三方 diff 库。

### 5. diff surface 是 footer command surface，不使用 alternate screen

新增 `DiffCommandSurface`，由 command handler 保存当前 `focus`、`selectedIndex` 和 `detailScroll`。renderer 只根据 surface 快照投影 UI：

- 顶部显示 `/diff`、source、文件数和总增删。
- 左侧显示文件列表、每个文件 `+N -N` 和当前选中项。
- 右侧显示当前文件 diff 详情。
- 详情宽度满足阈值时使用 old/new side-by-side；不足时使用 unified 单栏。
- 底部显示方向键和 Enter/Esc 提示，并显示 fallback 完整性 notice。

极窄终端下 renderer 可以压缩或隐藏文件列表，但必须保证内容不写满终端最后一列，并遵循现有 footer 高度预算和裁剪机制。

替代方案是沿用 demo 的 alternate screen。这个效果更接近全屏应用，但违反当前项目“不切 alternate screen、保留 scrollback”的硬约束；除非 footer surface 无法满足基本可用性，否则不采用。

### 6. 交互只使用现有输入事件

`/diff` 不新增 input parser 事件。交互映射为：

- `Up/Down`：list focus 下移动文件选择；detail focus 下滚动当前 diff。
- `Left/Right`：切换 list/detail focus。
- `Enter/Esc`：关闭 diff surface 并回到 composer。

不支持 hjkl、PageUp/PageDown、跳 hunk、搜索和手动切换 layout。布局完全由 renderer 根据可用宽度自动选择。

## Risks / Trade-offs

- [Risk] fallback diff 不完整，不能覆盖手动编辑或 shell 写入 → surface 明确提示来源和完整性边界；Git 仓库内优先使用 Git source。
- [Risk] 持久化 before snapshot 会增加 session 文件体积 → 复用 apply_patch 文件大小上限，并只记录受控文本文件；必要时对 history entry 数量和文本大小设置上限。
- [Risk] Git 命令可能因仓库状态、无 HEAD 或权限问题失败 → Git source 失败时降级到 history fallback，并在 notice 中说明降级原因。
- [Risk] 自研 line diff 算法在大文件上性能不稳定 → 对 fallback diff 文件大小和行数设限；Git source 直接解析 Git 输出，不走自研比较。
- [Risk] `/undo` 后持久化 history 与文件状态不一致 → `/undo` 成功后同步移除或标记对应 history entry，并立即持久化当前 session。
- [Risk] session 中持久化的 history 可能因外部文件变化而覆盖用户后续手动修改 → 继续沿用 `/undo` 的强制恢复语义，并在确认面板中提示会覆盖期间手动修改。
