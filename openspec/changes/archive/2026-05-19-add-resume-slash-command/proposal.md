## Why

当前 TUI 的 transcript records 只存在于进程内存中，退出后无法恢复；用户在同一项目目录下继续工作时，需要能够找回之前的对话上下文。新增 `/resume` 可以在不改变普通消息提交路径的前提下，为本地会话提供按目录分区的持久化与恢复入口。

## What Changes

- 新增 transcript 持久化能力：按当前工作目录分区，把会话记录保存到用户级 `~/.echo/echo_tui/` 目录下。
- 新增纯 `/resume` slash 命令：打开 `select` command surface，展示当前目录可恢复的会话列表。
- `/resume` 会话列表按 `updatedAt` 倒序排列，一次最多显示 5 条；Up/Down 移动选择时由 handler 更新可见窗口，不要求 footer renderer 新增虚拟列表能力。
- `/resume` 的选择不循环：到达第一条或最后一条后继续按 Up/Down 保持在边界。
- Enter 恢复选中的 session：替换当前 transcript records，并重绘当前 app snapshot，只显示恢复出来的 session transcript，不追加额外提示 record。
- Esc 取消 `/resume`，关闭命令会话并恢复普通 composer。
- `/resume more` 等带后缀输入继续回退为普通 user message。
- `/clear` 在持久化语义下仍只清当前可见 transcript，不删除已保存 session；清空后后续新消息应进入新 session。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: 扩展本地 slash 命令和 transcript 生命周期，新增按目录持久化的会话恢复能力与 `/resume` 选择型命令。

## Impact

- 影响 `src/app/main.js`：需要注入 transcript store，维护当前 session id，在 record commit 后保存，并提供恢复 session 的 app 层回调。
- 影响 `src/app/command-runtime.js` 与 `src/commands/command-effects.js`：需要新增恢复 transcript session 的 command effect，并通过窄回调解释。
- 影响 `src/commands/`：新增 `/resume` handler，并注册到默认 slash resolver。
- 影响 `src/persistence/` 或等价新模块：需要新增基于 Node.js 内置 `fs` / `path` / `os` / `crypto` 的 transcript store，不引入第三方依赖。
- 影响 `src/render/footer.js` 测试：复用现有 `select` surface 渲染，不新增 footer 虚拟列表逻辑。
- 影响 app / command 测试：覆盖持久化保存、恢复、5 条窗口滚动、非循环边界、取消、普通消息回退和 response 期间阻止。
- 影响文档与主 spec：更新 `docs/tui-architecture.md` 和 `openspec/specs/terminal-tui-prototype/spec.md`，说明 `~/.echo/echo_tui` 存储、`/resume` 行为和 `/clear` 与持久化历史的关系。
