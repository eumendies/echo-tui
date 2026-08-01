## Why

`src/app/main.ts` 同时承担生产装配、composer 提交状态机和完整输入事件优先级分发，导致 pending message、file mention、slash/shell 路由与按键处理只能通过大型闭包组合验证。现在需要把这两组已经形成独立不变量的逻辑提取为粗粒度控制器，让 `main.ts` 回到清晰的 composition root，同时不改变现有交互行为。

## What Changes

- 新增 `ComposerSubmissionController`，集中管理 live composer 消费、pending message 排队与串行 dispatch、command/skill/shell/file mention/conversation reference 路由，以及最终 assistant turn submission 构造。
- 新增 `InputEventController`，集中管理 key chunk 解析、active surface 优先级、composer 编辑事件、全局快捷键和 Esc/Submit/Exit 路由。
- `main.ts` 保留 terminal、renderer、store、context、command runtime、MCP/config lifecycle、shell 执行、assistant interruption 和 controller 装配，不把 renderer/terminal/process 生命周期转移到新控制器。
- 为两个控制器增加直接测试，覆盖提交副作用、pending dispatch、file mention、surface 优先级和 Esc 路由；不为测试向 `createApp()` 增加可选依赖集合。
- 保持 transcript 顺序、response lock、pending message、file mention、command、shell、surface 优先级、按键解析和中断行为不变。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `app-module-organization`: 将 composer 提交状态机和输入事件分发从 `main.ts` 提取为两个同级粗粒度控制器，并重新定义 main 应保留的装配职责。
- `composition-root-simplicity`: 明确新控制器只能接收真实运行协作边界，不能为了单元测试重新引入泛化或可选依赖集合，也不能退化为无状态转发 wrapper。

## Impact

- 主要影响 `src/app/main.ts`，并新增 `src/app/composer-submission-controller.ts`、`src/app/input-event-controller.ts` 及对应测试。
- 可能为 command runtime 和 assistant turn submission 增加最小、具名的内部 TypeScript 协议，但不改变 CLI、provider、transcript journal、render state 或用户配置格式。
- 不新增第三方依赖，不改变 `createApp()` 的公开创建参数，不改变 `--once` 路径。
