## 1. Bash runner 输出事件

- [x] 1.1 扩展 `BashCommandRunnerOptions`，新增可选 stdout/stderr 输出事件回调类型，并保持默认调用方无需传入。
- [x] 1.2 在共享 runner 的 stdout/stderr `data` handler 中触发输出事件，同时保持最终 stdout、stderr、合并 output、timeout、truncated 结果不变。
- [x] 1.3 为共享 runner 补充测试，覆盖 stdout/stderr 输出事件、最终 result 不变、截断时 preview 事件不会导致无限增长。

## 2. Shell pending 状态

- [x] 2.1 扩展 `PendingState`，新增 shell live output pending 类型，记录 command 和合并 output draft。
- [x] 2.2 在 TurnContext 中维护 shell live output draft，提供追加输出 chunk、读取 pending、清理 pending 的方法。
- [x] 2.3 确保 shell 命令完成、失败或清理状态时取消 pending render 并清除 live output draft。

## 3. App shell submit 接入

- [x] 3.1 在 `submitShellCommand()` 调用共享 runner 时传入输出事件回调。
- [x] 3.2 在输出事件回调中更新 shell pending draft，并使用 footer render 节流调度刷新。
- [x] 3.3 保持命令完成后只追加一条最终 shell transcript record，且 `shell ctx/local` 的 `includeInContext` 行为不变。
- [x] 3.4 shell mode 执行命令时关闭固定 timeout，改为通过 Escape 触发 AbortSignal 中断。
- [x] 3.5 对忽略 SIGTERM 的命令增加 SIGKILL 兜底，避免 Esc/timeout 后 runner 永久等待。

## 4. Footer 渲染

- [x] 4.1 为 shell live output pending 增加纯文本 shell 风格 renderer，不复用 assistant Markdown streaming 渲染。
- [x] 4.2 对长 live output preview 做 footer 高度限制和尾部显示摘要。
- [x] 4.3 确保 shell live output 运行中 status line 继续显示 working activity 和 shell ctx/local 状态。

## 5. 测试与验证

- [x] 5.1 增加 app 级测试：shell Promise 未 resolve 时输出事件能更新 footer pending，且 transcript 仍为空。
- [x] 5.2 增加 app 级测试：命令 resolve 后 pending 清空，并只追加一条最终 shell transcript record。
- [x] 5.3 增加 local shell 测试：运行中可见 live preview，完成后最终 record 仍不进入模型上下文。
- [x] 5.4 增加 render/footer 测试：shell live output 不走 Markdown，长输出受 footer 行数预算限制。
- [x] 5.5 增加 abort 测试：共享 runner 支持无 timeout 中断，app 层 Escape 会中断 active shell command，且 agent bash tool 保持 timeout。
- [x] 5.6 增加忽略 SIGTERM 的 abort/timeout 测试，确保终止兜底能结束 runner。
- [x] 5.7 运行 `npm run typecheck`、相关 targeted tests、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。
