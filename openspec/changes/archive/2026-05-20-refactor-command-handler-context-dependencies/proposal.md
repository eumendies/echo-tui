## Why

当前 slash command handler 统一接收由 `AppContext.createCommandContext()` 生成的大上下文；每新增一个需要读取 app 状态的命令，都要继续扩展这个聚合方法，导致 AppContext 和 command runtime 之间的依赖越来越难读，也会让无关 handler 被动暴露或计算不需要的数据。

这次重构要把命令依赖从“运行时统一派发大 context”调整为“handler 构造期显式声明并获取语义子 context”，在保留 command runtime 执行 effect 的前提下，让新增命令的依赖边界更清晰、更可扩展。

## What Changes

- 将 `AppContext` 中与 composer、transcript/session、model 信息、assistant turn/pending、render/banner 等语义相关的状态和操作拆成可组合的子 context。
- command handler 从共享 singleton object 迁移为可实例化 handler；构造函数只接收该 handler 实际需要的子 context 或纯配置。
- 新增默认 slash handler 注册入口，由 app 装配阶段把 AppContext 的子 context 注入到具体 handler，而不是由 command runtime 每次构造全量 command context。
- command runtime 继续负责 slash 路由、活跃 command session、事件分发和 effect interpreter；handler 仍然只返回 effect，不直接修改 transcript、renderer 或终端状态。
- 移除或收紧 `AppContext.createCommandContext()` 这类命令专用聚合上下文入口，避免它继续成为新增命令的必改膨胀点。
- 更新架构文档和相关测试，使 `/help`、`/model`、`/clear`、`/resume` 仍作为回归样例覆盖新的依赖注入方式。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `app-context-state-container`: AppContext 的职责从“提供统一 slash 可读大上下文”调整为“组合并暴露语义子 context，供 app 装配层显式注入 handler”。
- `terminal-tui-prototype`: slash command runtime 与 handler 协议保持用户可见行为不变，但 handler 依赖获取方式改为构造期显式注入，runtime 不再负责为所有 handler 拼装全量业务上下文。

## Impact

- 影响 `src/app/app-context.js`：需要拆分或组合语义子 context，并保留 AppContext 作为实例级总装容器。
- 影响 `src/app/main.js`：需要在 app 装配阶段创建默认 slash handlers，并把所需子 context 注入具体 handler。
- 影响 `src/app/command-runtime.js`：需要移除 `getContext()` 聚合业务上下文依赖，并删除未使用的 session config 能力。
- 影响 `src/commands/*-command-handler.js` 与 `src/commands/resolve-slash-command.js`：handler 迁移为实例化协议对象，resolver 仍按顺序询问 `match()`。
- 影响 `test/commands/`、`test/app/` 和可能新增的 AppContext 子 context 测试。
- 影响 `docs/tui-architecture.md`：需要同步 command handler dependency contract、AppContext 子 context 结构和 runtime 边界说明。
