## Why

当前用户想查看工作区文件变更时只能依赖手动执行 `git diff` 或回看 `apply_patch` 工具输出，体验和 `/undo` 等本地命令不一致。新增 `/diff` 可以在 TUI 内直接查看当前文件差异，并在非 Git 场景下利用已有受控编辑记录提供可接受的 fallback。

## What Changes

- 新增 `/diff` slash command，用于打开只读 diff 查看面板，不触发 assistant turn，不写入 transcript。
- 优先从 Git 工作区读取真实 diff；Git 不可用、当前目录不是 Git 工作区或 Git diff 读取失败时，回退到轻量持久化 change history 中的受控 `apply_patch` 历史。
- 新增 diff command surface：左侧文件列表、右侧当前文件 diff 详情；宽度足够时详情区使用 side-by-side 双栏，不足时自动退化为 unified 单栏。
- 交互仅支持方向键和 Enter/Esc：Up/Down 移动文件或滚动详情，Left/Right 切换文件列表和详情焦点，Enter/Esc 关闭。
- fallback diff 明确提示用户“非 Git 工作区，当前 diff 基于 apply_patch 历史拼接，可能不包含手动编辑或 shell 写入”；遇到 invalid checkpoint 时不跨越该边界。
- 非 Git fallback 的 change history 保持可序列化并随当前 session 持久化，使 `/resume` 恢复会话后仍可查看受控编辑 diff；`/undo` 可基于该 history 恢复。
- 更新 slash command 列表、用户文档和架构说明。

## Capabilities

### New Capabilities
- `diff-command`: 定义 `/diff` 命令的数据来源优先级、fallback 完整性提示、diff surface 自适应布局和方向键交互语义。

### Modified Capabilities
- 无。

## Impact

- 影响 `src/commands/`：新增 `/diff` command handler，并注册到默认 slash command handlers。
- 影响 `src/app/command/command-host.ts`、`src/types/command.ts`：新增受控 diff 领域能力和 diff surface 类型。
- 影响 `src/app/state/change-history-context.ts`、`src/types/change-history.ts`、`src/types/transcript.ts` 和 `src/persistence/transcript-store.ts`：持久化 `/undo` 和 fallback diff 共用的可序列化 change history，并保持 invalid 作为不可跨越边界。
- 影响 `src/render/footer/`：新增 diff surface renderer，复用现有 footer 局部重绘、高度预算和安全宽度约束。
- 影响 `src/input/`：第一版不新增 PageUp/PageDown 或 hjkl 事件，仅复用现有方向键、Enter、Esc。
- 影响测试和文档：新增 diff source、command handler、surface renderer、slash descriptor 和文档覆盖。
