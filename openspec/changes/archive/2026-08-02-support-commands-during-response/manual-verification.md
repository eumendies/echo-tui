# 手动验证清单

以下交互验证由用户在真实终端中执行：

1. 使用 fake agent 和真实 provider 分别启动长流式回答，确认 composer 仍可编辑。
2. 回答期间输入 `/`，确认只显示 `/help`、`/status`、`/context`、`/usage`、`/copy`，并验证 Up/Down、Tab、Enter。
3. 依次打开五个允许命令的 surface，确认后台流式回答继续；关闭后显示最新 pending draft。
4. Surface 打开时按 Esc，确认只关闭面板；再次按 Esc 才中断仍活跃的回答。
5. 先排队普通消息，再打开 `/status`，确认上一轮结束后普通消息可在 surface 后台自动开始。
6. 先排队未开放的 slash command，再打开响应期 surface，确认 queued command 等到 surface 关闭后只执行一次。
7. Surface 打开期间触发 tool approval 和 `ask_user_questions`，确认高优先级 surface 接管，处理后原 command surface 恢复。
8. 在 suggestion、streaming preview、command surface 和 approval 间切换，确认 footer 没有旧帧残留或重复内容。
9. 在 command surface 与 streaming 并存时调整终端宽度和缩小行数，确认 destructive recovery 后 transcript、surface 和 pending 状态正确。
10. 验证 Ctrl+C / Ctrl+D 仍清理终端并退出，未引入 alternate screen。
