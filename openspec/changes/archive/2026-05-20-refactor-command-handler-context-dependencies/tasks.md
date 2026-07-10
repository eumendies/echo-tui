## 1. 独立 context class 文件

- [x] 1.1 新建 `src/app/composer-context.js`，将 composer、输入历史、历史浏览索引、reset、输入历史浏览等职责迁移到 `ComposerContext` class。
- [x] 1.2 新建 `src/app/transcript-context.js`，将 transcript records、session 指针、session 持久化/恢复、resume session metadata 读取等职责迁移到 `TranscriptContext` class。
- [x] 1.3 新建 `src/app/model-context.js`，将 `/model` 信息读取与脱敏职责迁移到 `ModelContext` class。
- [x] 1.4 新建 `src/app/turn-context.js`，将 responding、pending、spinner 状态、assistant turn 生命周期等职责迁移到 `TurnContext` class。
- [x] 1.5 新建 `src/app/render-context.js`，将 terminal、previousColumns、banner/render state 派生职责迁移到 `RenderContext` class。

## 2. AppContext 收敛为组合根

- [x] 2.1 重构 `src/app/app-context.js`，让 `AppContext` 在构造函数中实例化并组合上述 context classes，自身不再保存运行态字段。
- [x] 2.2 删除 `AppContext` 中已经迁出的内联 context 对象实现，避免继续保留对象字面量/闭包式 context。
- [x] 2.3 删除 `AppContext.createCommandContext()`，确认命令系统不再依赖统一聚合 command context。
- [x] 2.4 保持 transcript 持久化、恢复、清空、输入历史、pending 和 assistant turn 用户可见行为不变。

## 3. Handler class 依赖注入

- [x] 3.1 保持默认 slash handler 注册入口，但改为注入新的 class context 实例。
- [x] 3.2 确认 `/help` handler 仍为 class，且不接收业务 context。
- [x] 3.3 确认 `/clear` handler 仍为 class，且只通过 clear transcript effect 请求写操作。
- [x] 3.4 让 `/model` handler 依赖 `ModelContext` class。
- [x] 3.5 让 `/resume` handler 依赖 `TranscriptContext` class。
- [x] 3.6 更新 resolver 默认路由来源，确保默认 handlers 来自 app 装配出的 class 实例。

## 4. Command runtime 边界收紧

- [x] 4.1 调整 `src/app/command-runtime.js`，继续移除 `getContext()` 对 AppContext 聚合业务上下文的依赖。
- [x] 4.2 删除未使用的 runtime-owned command session config 传递方式，保证 handler 协议收敛为 `handleEvent(session, event)`。
- [x] 4.3 确认 runtime 仍负责 active command session、事件分发、effect interpreter、renderFooter 触发和退出处理。

## 5. 测试与验证

- [x] 5.1 更新 AppContext 与各个独立 context class 的测试，验证实例隔离和职责边界。
- [x] 5.2 更新 command handler 单元测试，直接构造 handler class 与对应 context class 依赖。
- [x] 5.3 更新 command runtime 和 app 编排测试，覆盖默认 handler 注册、`/model`、`/resume`、`/clear`、`/help` 的端到端路由行为。
- [x] 5.4 运行 `npm test` 并修复所有失败。
- [x] 5.5 运行 `find bin src test -name '*.js' -exec node --check {} \;` 并修复所有语法错误。

## 6. 文档同步

- [x] 6.1 更新 `docs/tui-architecture.md` 中 AppContext、各个独立 context class、handler 协议和 runtime 边界说明。
- [x] 6.2 将文档中的旧内联 context / `createCommandContext()` 描述替换为“独立文件 + class context + handler 构造期依赖注入”模型。
- [x] 6.3 检查 `docs/README.md` 中 slash command 相关开发说明和检查命令，确保与新文件结构一致。
