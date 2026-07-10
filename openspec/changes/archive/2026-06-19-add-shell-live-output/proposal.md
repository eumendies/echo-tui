## Why

shell mode 当前执行命令时只显示 working spinner，必须等待 bash 命令结束后才一次性追加 transcript；长时间运行的命令缺少即时反馈，用户无法判断命令是否仍在输出、卡住或已经接近完成。

## What Changes

- 在 shell mode 执行期间，将 stdout/stderr 的合并终端输出作为临时 live preview 显示在 footer pending 区域。
- 命令完成后仍只追加一条最终 shell transcript record，保持 transcript append-only 和 `shell ctx/local` 上下文策略不变。
- 扩展共享 bash runner，让 shell mode 可以接收输出 chunk；agent `run_bash_command` tool 默认行为保持不变。
- 使用现有 footer redraw/节流机制刷新 live preview，不直接把子进程输出写入 terminal。
- 不引入 PTY 或完整 terminal emulator；本变更只覆盖非交互 bash 命令的 pipe 输出预览。

## Capabilities

### New Capabilities

### Modified Capabilities
- `shell-mode`: shell mode 执行长命令时新增运行中输出预览行为，并约束最终 transcript 与上下文投影语义不变。

## Impact

- 影响 bash runner：`src/tools/bash-command-runner.ts` 需要提供可选输出事件回调。
- 影响 app shell submit 路径：`src/app/main.ts` 需要接收 runner 输出事件并更新 pending preview。
- 影响状态与渲染类型：`src/types/render.ts`、`src/app/turn-context.ts`、`src/render/blocks.ts`、`src/render/footer.ts` 需要支持 shell 输出 pending 状态。
- 影响测试：需要覆盖 runner 输出回调、shell mode 运行中 footer preview、完成后最终 transcript、local shell 上下文隔离和 footer 渲染行数限制。
