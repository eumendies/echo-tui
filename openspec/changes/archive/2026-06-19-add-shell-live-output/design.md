## Context

当前 shell mode 在 `submitShellCommand()` 中启动 working spinner 后直接 `await runShellCommand(...)`，直到 bash 进程关闭才追加最终 shell transcript。共享 bash runner 已经通过 pipe 监听 stdout/stderr，但只写入内部 capture，没有向 app 层暴露运行中的输出事件。

TUI 渲染架构中，footer 是唯一可安全反复重绘的临时区域；transcript 是 append-only 的事实日志。assistant streaming 已经存在 pending preview 和 50ms footer render 节流机制，适合复用为 shell live output 的展示通道。

## Goals / Non-Goals

**Goals:**

- shell mode 命令运行中即时展示 stdout/stderr 合并输出，让长命令不再只有 spinner。
- 运行中输出只作为 footer pending preview，不写入 transcript。
- 命令完成后仍只追加一条最终 shell transcript record，并保持 `shell ctx/local` 的上下文策略不变。
- bash tool handler 继续使用共享 runner，但不自动展示 agent tool 的流式输出。
- 复用现有 footer redraw 约束和节流机制，避免直接写 terminal 破坏 cursor/footer 状态。

**Non-Goals:**

- 不实现 PTY 或完整 terminal emulator。
- 不支持交互式程序、stdin 转发、TTY resize 或 terminal 控制序列仿真。
- 不把 stdout/stderr 以不同颜色或 segment 形式精细区分；第一版展示合并终端输出。
- 不将每个输出 chunk 追加为 transcript record。
- 不改变 provider converter 对最终 shell record 的投影语义。

## Decisions

### 使用 pipe 输出事件，而不是 PTY

共享 runner 继续使用 `stdio: ['ignore', 'pipe', 'pipe']`。在 stdout/stderr `data` handler 中新增可选 `onOutput` 回调，把输出 chunk 通知 shell mode。

选择 pipe 的原因是当前 shell mode 定位为非交互命令执行；pipe 已能覆盖 `for/sleep/echo`、测试命令、构建命令等常见长命令输出预览。PTY 能提供更真实的终端行为，但会引入 ANSI 控制、终端尺寸、stdin、Ctrl+C 和依赖复杂度，不适合作为本次变更范围。

### live output 放入新的 shell pending state

新增 `PendingState` 分支，例如 `kind: 'shell_output'`，包含 command 和合并 output draft。运行中每个输出事件更新该 pending state，并通过 footer preview 展示。

不复用 `kind: 'streaming'`，因为现有 streaming 是 assistant 语义，会走 Markdown 渲染和 `◇` 样式。shell 输出应保持纯文本、shell 风格，不应被 Markdown 表格、标题或代码块解释。

### 复用 footer render 节流

`onOutput` 回调不直接调用 `renderFooter()`，而是更新 TurnContext 状态后调用现有 streaming render 调度能力。这样可以把高频 stdout/stderr chunk 合并到约 50ms 的 footer redraw 窗口，避免终端频繁重绘。

实现时可以先复用现有 `scheduleStreamingRender()`；如果命名影响可读性，可在实现阶段将其重命名或补充别名为更通用的 pending render 调度。

### 完成后只落最终 shell transcript

runner Promise resolve 后，shell mode 取消未执行的 footer render、清理 pending/working 状态，并用最终 `BashCommandRunResult` 追加一条 shell transcript record。最终 record 继续由 runner 的 stdout/stderr/output capture 生成，live preview 不作为持久事实来源。

### preview 输出需要有边界

live preview 不能无限增长。第一版可以让 TurnContext 的 shell output draft 保留与 runner 捕获上限相近的文本，或者让 output capture 返回实际接受的 chunk，使 preview 与最终 transcript 截断语义一致。无论采用哪种实现，footer 渲染必须按现有 rows 预算只显示尾部。

## Risks / Trade-offs

- [Risk] pipe 模式下部分程序会因为 stdout 不是 TTY 而缓冲输出，实时性不如真实 terminal。→ Mitigation：明确本变更不做 PTY；第一版解决非交互命令的主要反馈问题。
- [Risk] 高频输出导致 footer redraw 过多。→ Mitigation：复用 50ms render 节流，不在 chunk 回调中直接渲染。
- [Risk] shell 输出被 Markdown 渲染误解释。→ Mitigation：新增 shell 专用 pending renderer，使用纯文本/shell 风格。
- [Risk] live preview 与最终 transcript 不一致。→ Mitigation：最终 transcript 只以 runner result 为准；preview 使用同一输出上限或独立尾部窗口。
- [Risk] local shell 输出在运行中可见但不应进入模型上下文。→ Mitigation：运行中 pending 不进入 transcript/provider；完成后仍使用 `includeInContext: false`，现有 provider/compaction 过滤继续生效。
