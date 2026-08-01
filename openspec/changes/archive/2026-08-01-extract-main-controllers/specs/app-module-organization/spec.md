## MODIFIED Requirements

### Requirement: App 主流程保持粗粒度清晰
系统 SHALL 将 `src/app/main.ts` 保持为 app 的生产装配与主流程入口，并通过独立的粗粒度 assistant turn runner、composer submission controller 和 input event controller 降低其复杂度。系统 MUST NOT 为了降低行数而把 render 协调、surface 状态、shell execution、MCP/config lifecycle 或退出清理拆成大量细碎文件。

#### Scenario: main 保留生产装配与跨流程生命周期
- **WHEN** 开发者阅读 `src/app/main.ts`
- **THEN** 文件 SHALL 继续展示 terminal、renderer、AppContext、command runtime、tool/user state context、MCP manager、agent runtime 和两个 controller 的生产装配关系
- **THEN** 文件 SHALL 保留 render/append、MCP bootstrap、config watcher、shell execution、assistant interruption、resize、start 和退出清理

#### Scenario: assistant turn 生命周期独立
- **WHEN** 普通用户消息需要驱动一次 agent 响应
- **THEN** assistant turn 的 `runAgent` callback 翻译、streaming pending、tool call/result、complete、abort/error 收尾 SHALL 位于独立的粗粒度 `assistant-turn-runner.ts` 模块
- **THEN** 该模块 SHALL 作为 `main.ts` 的同级 app 模块保留在 `src/app/` 根下，不为单个文件单独创建 lifecycle 目录
- **THEN** composer submission controller SHALL 只准备最终 assistant submission，并通过 main 装配的真实运行边界调用该 runner

#### Scenario: composer 提交状态机独立
- **WHEN** 用户提交 live composer 或系统自动处理 pending message
- **THEN** composer 消费、输入历史、pending enqueue/claim/dispatch、command/skill/shell/file mention/reference 路由 SHALL 由一个粗粒度 submission controller 协调
- **THEN** `main.ts` SHALL NOT 重复实现同一套提交状态机

#### Scenario: 输入事件优先级独立
- **WHEN** stdin chunk 被解析并分发为输入事件
- **THEN** key parser 状态、active surface 优先级、composer 编辑、快捷键和 Esc/Submit/Exit 路由 SHALL 由一个粗粒度 input event controller 协调
- **THEN** `main.ts` SHALL 只注册该 controller 的稳定输入入口，不重复维护事件优先级分支

## ADDED Requirements

### Requirement: 两个 controller 保持现有交互语义
系统 SHALL 将 submission 和 input event 逻辑提取为结构性重构，不得改变 transcript record 顺序、response lock、pending message、file mention、conversation reference、command、shell、surface 优先级、按键解析或 interruption 语义。

#### Scenario: pending submission 行为保持
- **WHEN** active assistant turn 期间排队的消息在 turn 完成、失败或中断后自动处理
- **THEN** submission controller SHALL 保持现有单槽、一次 claim、输入历史只记录一次和后来 composer 草稿隔离语义
- **THEN** queued file mention 和 slash command SHALL 继续复用普通提交路由

#### Scenario: 输入 surface 优先级保持
- **WHEN** user question、tool approval、file picker、command session、reference preparation 或本地 info surface 处于活跃状态
- **THEN** input event controller SHALL 按重构前的既有顺序让高优先级状态消费事件
- **THEN** 低优先级 composer、Esc interruption 或 Submit 路由 SHALL NOT 提前消费该事件

#### Scenario: Esc 顺序保持
- **WHEN** 普通输入层收到 Esc
- **THEN** 系统 SHALL 继续按 pending message、conversation reference、active shell command、active assistant turn 的顺序尝试处理
- **THEN** 每个成功处理者 SHALL 阻止后续低优先级动作执行
