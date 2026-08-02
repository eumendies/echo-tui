## 1. 命令能力与运行时约束

- [x] 1.1 扩展 command handler 和 slash descriptor 类型，加入默认关闭的 `allowDuringAssistantTurn` 字段，并让 descriptor 从 handler 单一来源派生该能力。
- [x] 1.2 为 `/help`、`/status`、`/context`、`/usage` 和 `/copy` 标记响应期可用，确认其他内置命令、agent workflows 和 direct skill invocation 保持默认关闭。
- [x] 1.3 扩展 command runtime 的启动上下文校验，使 active assistant turn 期间只能启动已允许 handler，并禁止已有 active command session 被新的启动请求静默覆盖。
- [x] 1.4 更新 command runtime 和 slash command 测试，覆盖默认拒绝、允许命令启动、首批开放清单、descriptor 派生以及 active session 不被替换。

## 2. 响应期 Slash Suggestions

- [x] 2.1 调整 `SlashSuggestionContext` 的可见性和候选过滤：空闲时保留完整命令/skill，active assistant turn 期间仅保留响应期可用命令，active surface 期间继续隐藏。
- [x] 2.2 让 `AppContext` 使用真实 active assistant turn 状态而不是宽泛 `responding` 判定响应期 suggestions，保持 shell、手动 compact 和 MCP bootstrap 的既有边界。
- [x] 2.3 增加 suggestion/controller 测试，覆盖响应期间 `/` 候选、前缀过滤、Up/Down、Tab、Enter、空闲完整候选和 surface 接管时隐藏。

## 3. Composer 提交与 Pending 路由

- [x] 3.1 重排 active assistant turn 期间的 composer 提交流程，在 pending enqueue 前优先解析并立即启动允许的响应期命令，同时保持输入 history 只记录一次和 composer 草稿消费语义。
- [x] 3.2 保持普通文本、未开放命令和 skill invocation 的单槽 pending 行为，并确保已有 pending 消息时仍可立即执行响应期命令且不覆盖原消息。
- [x] 3.3 为 pending dispatch 增加 command candidate 与普通消息的区分：普通消息可在只读 command surface 打开时自动开始下一轮，queued slash command 在 active command session 关闭前保持未 claim。
- [x] 3.4 在 command session 关闭后重新尝试 pending dispatch，覆盖同步关闭、异步 handler 收尾和重复回调，确保 queued command 至多执行一次且 live composer 草稿不受影响。
- [x] 3.5 增加 app/controller 和 pending-message 测试，覆盖响应期立即命令、普通消息排队、已有单槽、surface 打开时普通消息自动发送、queued command 延后及关闭 surface 后恢复执行。

## 4. Surface 与流式渲染稳定性

- [x] 4.1 验证并补齐 command surface 活跃期间的输入优先级，使 Esc 关闭 surface 而不打断后台 assistant turn，tool approval 和 user question 可临时覆盖后恢复原 command surface。
- [x] 4.2 保持 streaming draft、thinking/working 和 transcript append 在 surface 打开期间继续更新；surface 关闭后投影最新 pending 状态而不是旧帧。
- [x] 4.3 增加 footer renderer 测试，覆盖 streaming → slash suggestions → command surface → 持续 token/稳定 transcript append → surface 关闭的高度清理、`rows - 2` 预算和光标状态。
- [x] 4.4 增加 resize/destructive recovery 测试，确认响应期 command surface、pending preview 和 transcript 快照不会产生重复或残留临时输出。

## 5. 验证与文档同步

- [x] 5.1 更新 `/help` 或相关用户文档，说明响应期间仅部分 slash command 可用、surface 的 Esc 优先级以及普通消息仍使用单槽排队。
- [x] 5.2 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`，修复全部回归。
- [x] 5.3 整理供用户手动验证的 TUI 场景：真实/假流式输出期间 suggestion、五个开放命令 surface、pending 普通消息、queued command、approval/question 抢占、Esc 语义和 resize。
