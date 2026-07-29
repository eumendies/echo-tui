## 1. Footer 单帧写入

- [x] 1.1 重构 `createFooterRenderer` 的旧 footer 清理逻辑，使其只生成 ANSI 序列，并让独立 `clear()` 复用该序列后执行一次写入
- [x] 1.2 将普通 `render()` 的清理、新 layout 输出和光标恢复拼接为一个序列，通过单次 `output.write()` 写出并保持 remembered layout 语义
- [x] 1.3 增加 footer renderer 测试，覆盖已有 footer 的单次写入、新布局缩短时完整清理、composer 光标恢复、command surface 隐藏光标和独立 clear 重置

## 2. 统一高频刷新调度

- [x] 2.1 从 `TurnContext` 和 app composition root 移除独立 streaming render timer、50ms 窗口锚点及对应配置/取消 API，保留单一 100ms 活动刷新时钟
- [x] 2.2 调整 assistant token 与 shell output 回调，使其只累计最新 pending draft，由活动刷新 tick 批量绘制，不再由每个高频事件调度 footer redraw
- [x] 2.3 复查并保留 tool call、approval、user question、assistant segment、完成、失败、中断和 resize 的即时 append/redraw，确保活动停止前后的最终 draft 与 shell 输出不会丢失
- [x] 2.4 增加 turn/controller 测试，验证一个周期内多个 token/chunk 被合并、周期 tick 使用最新快照、结构性事件即时更新，以及首次 tick 前完成仍绘制最终内容

## 3. 回归验证

- [x] 3.1 运行 `npm run typecheck` 并修复类型或接口残留
- [x] 3.2 运行 `npm test`，确认 footer、assistant streaming、shell streaming、interrupt 和 resize 相关回归通过
- [x] 3.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`，确认 JavaScript 测试与脚本语法有效
- [x] 3.4 向用户提供真实终端手动验证清单，重点比较 fake/real 高吞吐 streaming、shell 连续输出、approval/question surface、resize、Esc 中断和最终光标清理的频闪与首字延迟
