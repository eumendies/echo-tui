## Why

当前 slash command runtime 已经支持 `info` 和 `select` 两类 command surface，但 `confirm` surface 还没有真实用户命令链路。新增 `/clear` 可以提供一个自然的确认型本地命令，用于清空当前 transcript，同时验证 confirm surface、command session 和 effect interpreter 的闭环。

## What Changes

- 新增纯 `/clear` slash 命令：打开 `confirm` command surface，提示用户确认是否清空当前 transcript。
- 用户在 `/clear` 会话中按 Enter 时，清空当前 transcript records 并恢复普通 composer 输入界面。
- 用户在 `/clear` 会话中按 Esc 时，取消清空并恢复普通 composer 输入界面。
- `/clear` 不进入上下键回溯的输入历史，不启动 fake agent，不追加 transcript record。
- `/clear more` 等带后缀输入继续回退为普通 user message。
- 补充测试和架构文档，覆盖 confirm surface、`/clear` handler、app 集成和手工验证路径。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: 扩展 slash 命令能力，新增 `/clear` 确认型本地命令，并要求其只清空 transcript、不清空 session 输入历史。

## Impact

- 影响 `src/commands/`：新增 `/clear` handler，并注册到 slash resolver。
- 影响 `src/commands/command-effects.js` 和 `src/app/command-runtime.js`：需要新增一个清空 transcript 的 command effect 或等价 app host 能力。
- 影响 `src/app/main.js`：提供清空 transcript records 并触发当前 app snapshot 重绘的窄回调。
- 影响 `src/render/footer.js` 测试：补充 `confirm` command surface 渲染覆盖。
- 影响 app / command 测试：覆盖 `/clear` 打开、确认、取消、普通消息回退，以及保留输入历史。
- 影响 `docs/tui-architecture.md`：更新已接入 slash 命令列表与 `confirm` surface 示例。
