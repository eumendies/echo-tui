## 1. Transcript store 与持久化模型

- [x] 1.1 新增 transcript store 模块，默认根目录为 `~/.echo/echo_tui/`，并支持测试注入临时 rootDir。
- [x] 1.2 实现 cwd hash 分区、project metadata 和 session JSON 路径生成，确保不会把历史文件写入当前项目目录。
- [x] 1.3 实现 session JSON schema：`schemaVersion`、`sessionId`、`cwd`、`createdAt`、`updatedAt`、`records`，并从 records 派生列表展示 metadata。
- [x] 1.4 实现 atomic write 保存 session：写临时文件后 rename，避免半截 JSON。
- [x] 1.5 实现 `listSessions(cwd)`：扫描当前 cwd 分区 session 文件，跳过损坏或不支持 schema 的文件，并按 `updatedAt` 倒序返回 metadata。
- [x] 1.6 实现 `loadSession(cwd, sessionId)` 和保存当前 session 的接口，并补充 store 单元测试。

## 2. App 层 session 生命周期

- [x] 2.1 在 `src/app/main.js` 注入 transcript store，维护 `currentSessionId`，并在测试中可替换为 fake store。
- [x] 2.2 普通 user transcript record commit 后创建或更新当前持久化 session。
- [x] 2.3 assistant 完成并追加 transcript record 后更新当前持久化 session 和 `updatedAt`。
- [x] 2.4 实现 app 层 `loadTranscriptSession(sessionId)` 窄回调：加载 records、替换当前 transcript records、设置 `currentSessionId` 并 destructive/full snapshot 重绘。
- [x] 2.5 调整 `/clear` 的清空 transcript app 逻辑：清空当前可见 records 后 detach `currentSessionId`，但不删除或覆盖旧 session 文件。
- [x] 2.6 确认持久化逻辑不保存 composer、pending、command session 或 input history。

## 3. Command effect 与 runtime 集成

- [x] 3.1 在 `src/commands/command-effects.js` 新增恢复 transcript session 的 effect type 和 `create*Effect` helper。
- [x] 3.2 在 `src/app/command-runtime.js` 解释恢复 session effect，通过 app 注入的 `loadTranscriptSession(sessionId)` 执行真实恢复，并保持未知 effect 显式报错。
- [x] 3.3 扩展 command context，只暴露 `/resume` 所需的 session metadata 和 transcript 状态信息，不把完整 records 或 store 实例泄露给 handler。

## 4. /resume handler 与注册

- [x] 4.1 新增 `src/commands/resume-command-handler.js`，只匹配纯 `/resume`，带参数或后缀的输入继续走普通消息路径。
- [x] 4.2 `/resume` 启动时读取当前 cwd 可恢复 session metadata；无 session 时打开可关闭的空状态 command surface。
- [x] 4.3 有 session 时打开 `select` command surface，按 `updatedAt` 倒序展示最多 5 条 session。
- [x] 4.4 在 handler session data 中维护全量 session metadata、绝对 `selectedIndex`、`windowStart` 和 `pageSize: 5`。
- [x] 4.5 实现 Up/Down 非循环选择：到达第一条或最后一条后继续按同方向键保持在边界。
- [x] 4.6 实现窗口滚动：选中项越过当前 5 条窗口边界时，通过 `update_command_session` 更新 surface 的可见 options 和相对 selectedIndex。
- [x] 4.7 Enter 恢复选中 session：关闭会话、清空 composer、触发恢复 session effect；恢复后不追加 transcript 提示。
- [x] 4.8 Esc 取消 `/resume`：关闭会话、清空 composer、保持当前 transcript records 不变。
- [x] 4.9 将 `/resume` handler 注册到默认 slash resolver，保持 `/help`、`/model`、`/clear` 和自定义 resolver 行为不变。

## 5. 测试覆盖

- [x] 5.1 补充 transcript store 测试：路径分区、保存/加载、atomic write 可观测行为、损坏 JSON 跳过、`updatedAt` 排序。
- [x] 5.2 补充 `/resume` handler / resolver 测试：纯匹配、普通消息回退、空状态、有 session select surface、Enter/Esc effects。
- [x] 5.3 补充 `/resume` 窗口滚动测试：超过 5 条时初始窗口、Down 向下滚动、Up 向上滚动、首尾非循环边界。
- [x] 5.4 补充 command runtime 测试：恢复 session effect 的解释和未知 effect 回归。
- [x] 5.5 补充 app 集成测试：普通提交后持久化 user/assistant records、`/resume` 恢复选中 session、恢复不追加提示、Esc 取消不替换 transcript、response 期间阻止 `/resume`。
- [x] 5.6 补充 `/clear` 与持久化关系的 app 集成测试：`/clear` 不删除旧 session，清空后新消息进入新 session。

## 6. 文档与验证

- [x] 6.1 更新 `docs/tui-architecture.md`，说明 transcript store、`~/.echo/echo_tui/` 存储、`/resume` 流程和 `/clear` detach 语义。
- [x] 6.2 更新 `docs/README.md`，说明用户如何使用 `/resume`、恢复列表最多显示 5 条、历史文件保存位置和隐私注意事项。
- [x] 6.3 更新 OpenSpec 主 spec 同步所需的 delta 内容，确保 `/resume` 和持久化行为可归档。
- [x] 6.4 运行 `npm test`，确认全量自动化测试通过。
- [x] 6.5 运行 `find bin src test -name '*.js' -exec node --check {} \;`，确认所有 JavaScript 文件语法通过。
- [x] 6.6 使用 `npm start` 手工验证：提交消息后退出重启，`/resume` 显示会话列表，超过 5 条时可滚动且不循环，Enter 恢复只显示对应 transcript，Esc 取消，`/resume more` 普通提交，`/clear` 后仍可恢复旧 session。
