## Why

当前 slash 子系统已经有了一个最小版 `/help`，但它的结构仍偏单点特判：提交路径负责命中 slash，命令模块直接返回固定结果，overlay 活跃时的事件分发也主要集中在 `src/app/main.js`。继续按这个方向叠加 `/model`、`/status`、`/clear` 等不同形态的命令时，复杂度会同时长在 app 状态机、footer surface 分支和命令模块边界上，可扩展性会很快变差。

现在重构 slash 运行时是合适的，因为系统已经验证了本地命令、overlay、Esc 退出和 footer-only redraw 这条主路径可行；接下来更需要一个能承载“静态说明、可选择列表、确认框、transcript 输出”等不同命令形态的统一架构，而不是继续新增分散特判。

## What Changes

- 把当前 slash 子系统重构为统一的命令运行时：提交文本先路由到命令 handler，handler 负责匹配与处理，app 通过统一的 effect interpreter 执行结果。
- 采用由各个 handler 自行决定是否匹配的路由方案：slash 路由器依次询问 handler 是否命中；当前第一批 handler 仍采用全文精确匹配，为未来支持参数和更复杂匹配预留接口。
- 引入显式的 command session 概念，用于承载交互式 slash 命令（如 help overlay、未来的 model 选择器）在激活期间的状态与事件处理。
- 将 slash 命令的结果统一为结构化 effect，而不是让各命令直接修改 app 状态或渲染分支；effect 可以表达打开/更新/关闭 command session、追加 transcript、更新会话配置等动作。
- 保持现有 `/help` 外部行为不变，但将其迁移到新的 handler + session + effect 运行时下。
- 为未来的不同命令形态预留扩展面：静态 overlay、选择型 overlay、确认型 overlay，以及向 transcript 区域输出结果的命令。

## Capabilities

### New Capabilities
- 无

### Modified Capabilities
- `terminal-tui-prototype`: 调整 slash 命令的路由与执行模型，要求命令通过统一 handler、command session 和 effect interpreter 集成到现有 app/renderer 架构中，同时保持现有 `/help` 行为不回退。

## Impact

- 受影响代码：`src/app/main.js`、`src/commands/`、footer/app renderer 相关渲染状态，以及对应测试。
- 受影响行为：slash 路由入口、overlay 活跃时的事件分发、命令结果如何更新 footer/transcript/session 配置。
- 本次不要求新增具体业务命令的最终产品能力，但会为后续 `/model`、`/status` 等命令提供统一运行时骨架。
