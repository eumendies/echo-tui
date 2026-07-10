## Why

当前项目已经支持 lifecycle hooks，但用户只能手写 `~/.echo/config.json`，配置错误、运行测试和日常管理都缺少 TUI 内入口。新增 `/hooks` 可以让 hooks 从“隐藏配置能力”变成可管理、可验证的运行时能力，同时保持 hooks 作为旁路观察者的安全边界。

## What Changes

- 新增 `/hooks` slash command，用于查看和管理 lifecycle hook entries。
- `/hooks` 支持按事件管理 hook：添加、编辑命令、编辑 timeout、启用/停用、删除、保存并即时 reload。
- `/hooks` 支持测试单条 hook command，默认使用系统构造的 synthetic payload，不触发真实 assistant/tool/compaction 生命周期。
- `/hooks` 测试模式可展示本次测试结果，包括 exit code、timeout、耗时，以及截断后的 stdout/stderr；测试输出不写 transcript、不持久化、不回传模型。
- `/hooks` 不内嵌配置示例或完整 payload 文档；事件语义、配置示例和 payload 字段说明继续放在 README/docs。
- 扩展 lifecycle hooks 配置读取与 dispatcher reload 能力，使 `/hooks` 保存后的配置在当前 TUI 进程中生效。
- 第一版 hook 测试使用 synthetic payload；真实 payload replay 可在后续变更中单独设计。

## Capabilities

### New Capabilities
- `hooks-command`: 定义 `/hooks` 管理、保存、reload 和 hook 测试的用户可见行为。

### Modified Capabilities
- `lifecycle-hooks`: 扩展 hooks 配置和 dispatcher 行为，以支持 `/hooks` 管理后的即时 reload、可诊断配置读取，以及测试/重放所需的受控执行入口。

## Impact

- 影响 `src/commands/`：新增 `/hooks` command handler，并接入 slash command resolver。
- 影响 `src/types/command.ts` 和 render footer surface：新增 hooks command surface、状态类型和渲染分支。
- 影响 `src/app/command/command-host.ts`：新增 `host.hooks` 领域能力，避免 command 直接读写用户配置或 dispatcher。
- 影响 `src/hooks/`：新增 hooks config draft/editor、dispatcher reload 或可更新配置能力、测试执行入口和可选 recent payload 缓存。
- 影响 `src/config/user-config.ts` 或相关配置编辑器：需要安全读写 `~/.echo/config.json#hooks`，并保留其它配置节点。
- 影响测试：新增 hooks command、config editor、dispatcher reload、synthetic test payload 和渲染单元测试。
- 不引入第三方 TUI 库，不改变 hooks 旁路观察者语义，不让 hook 结果影响 assistant、tool approval、tool execution、compaction 或 transcript。
