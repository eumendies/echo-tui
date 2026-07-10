## Why

`src/app/main.js` 已经承担 terminal、input、render、fake agent、history 和 slash command runtime 多个职责，当前文件偏重。`/model` 的落地验证了 slash command handler/effect/surface 边界已经稳定，现在适合把 command runtime 从 app 编排入口中抽出，让 `main.js` 更聚焦于顶层 orchestration。

## What Changes

- 新增 app 层 command runtime 模块，集中管理 slash command session、session config、effect interpreter 和活跃命令事件分发。
- `src/app/main.js` 继续作为 composition root，负责依赖装配、普通输入事件分发、普通消息提交、fake agent 生命周期和渲染调用，但不再内联 slash effect interpreter 的细节。
- 保持现有 `/help`、fake `/model` 和自定义注入 slash handler 的用户可见行为不变。
- 保持现有 command handler 契约、command effect types 和 renderer `commandSurface.kind` 契约不变。
- 更新测试与架构文档，说明 command runtime 的新模块边界。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: 修改模块边界要求，明确 slash command runtime 由独立 app 子模块承载，而不是内联在 `src/app/main.js` 中。

## Impact

- 影响 `src/app/main.js`：移除 slash command session/effect interpreter 的内联实现，改为调用新 command runtime 模块。
- 新增 `src/app/command-runtime.js`：承载 command session、effect interpreter 和命令会话事件分发。
- 影响测试：新增或调整 command runtime 单测，并保持现有 app orchestration 测试覆盖 `/help`、`/model` 和可注入 handler。
- 影响文档和 OpenSpec 主 spec：同步新的模块边界说明。
- 不引入第三方依赖，不改变 CLI 启动方式，不改变 terminal 渲染策略。
