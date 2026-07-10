## Why

当前 assistant loop 可能通过 `apply_patch` 等受控文件工具修改工作区，但用户如果对上一轮结果不满意，只能手工反向编辑或依赖 Git。并非所有工作目录都是 Git 仓库，而且 Git 的粒度也不等同于“上一轮模型操作”，因此需要一个 repo-agnostic、与 transcript 一致的 `/undo` 能力。

## What Changes

- 新增 `/undo` slash command，用于回退上一轮 assistant loop 产生的受控文件修改，并同步回退该轮 transcript records。
- 新增 undo checkpoint stack / journal，在 assistant turn 开始时记录 transcript 边界和 compaction 状态，在受控文件工具写盘前记录 snapshot 镜像，写盘后记录写入状态。
- 第一版只承诺回退受控文件编辑工具产生的修改，例如 `apply_patch`；对不可追踪的写入型 `run_bash_command`，`/undo` SHALL 拒绝执行并给出可理解说明。
- 新增 `/undo` 确认 UI，用三行短文案展示将回退的对话与文件变更、文件数量摘要和手动修改覆盖风险；确认后执行文件恢复、transcript 截断和 redraw。
- 不引入 Git 依赖，支持当前进程内连续多次 undo，不把 undo checkpoint 持久化到跨进程 session。

## Capabilities

### New Capabilities
- `undo-command`: 定义 `/undo` 的 assistant loop 回退能力，包括受控文件修改 journal、transcript/compaction 回退、多 checkpoint 栈、不可追踪修改拒绝和用户确认后强制恢复上一轮状态的语义。

### Modified Capabilities
- 无。

## Impact

- `src/commands/`: 新增 `/undo` command handler，并注册到默认 slash command 集合。
- `src/app/state/`: 新增或扩展 undo 状态管理，记录当前进程内的 assistant turn checkpoint 栈，并为 transcript 提供受控截断/恢复能力。
- `src/app/assistant-turn-runner.ts`、`src/app/state/turn-context.ts`、`src/app/state/app-context.ts`：在 assistant loop 生命周期中创建、完成或废弃 undo checkpoint。
- `src/tools/` 与 `src/types/tool.ts`：让 `apply_patch` 等受控文件工具在写盘前后向 undo journal 暴露文件修改信息；不可追踪写入型工具应使 checkpoint 失效。
- `src/types/transcript.ts`、`src/persistence/transcript-store.ts`：如需保存额外 session 元数据，只限当前进程内状态；第一版不要求持久化 undo 备份。
- `src/render/footer/` 与测试：复用现有 confirm/info command surfaces 展示 `/undo` 成功、不可用、失败或确认状态。
