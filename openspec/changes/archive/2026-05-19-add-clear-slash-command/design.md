## Context

当前 TUI 已经通过 `src/app/command-runtime.js` 抽出了 slash command runtime，并已有 `/help` 使用 `info` surface、`/model` 使用 `select` surface。`src/render/footer.js` 已支持 `confirm` surface，但还没有真实 slash 命令从用户输入走到该分支。

`/clear` 是一个天然需要确认的本地命令：它会清空当前 transcript records，但不应该清空 session 输入历史。这个行为既能补齐 confirm surface 的真实产品链路，也能继续验证 slash handler / effect / command runtime 的边界。

## Goals / Non-Goals

**Goals:**

- 新增纯 `/clear` slash 命令，打开 `confirm` command surface。
- Enter 确认后清空当前 transcript records，并恢复普通 composer 输入界面。
- Esc 取消后不改 transcript，并恢复普通 composer 输入界面。
- `/clear` 不进入输入历史、不启动 fake agent、不追加 transcript record。
- 清空 transcript 时保留上下键回溯使用的 session 输入历史。
- 补齐 `confirm` surface 的 render 测试、handler 测试和 app 集成测试。

**Non-Goals:**

- 不新增持久化清理能力；`/clear` 只影响当前进程内 transcript records 和当前屏幕投影。
- 不清空 input history，也不改变 Up/Down 历史浏览规则。
- 不改变 `/help`、`/model`、普通消息提交或 fake assistant 生命周期。
- 不引入全局状态容器、事件总线或第三方依赖。

## Decisions

1. **新增 `/clear` handler，而不是测试专用 confirm demo。**
   - 理由：`/clear` 是用户可理解的真实本地命令，confirm 语义自然；相比 `/confirm-demo` 不会引入测试味的产品入口。
   - 备选：只在 `footer.test.js` 里构造 confirm surface；这能补渲染覆盖，但不能验证真实 slash runtime 链路。

2. **通过新的 command effect 请求清空 transcript。**
   - 计划新增类似 `clear_transcript_records` 的 effect type 和 helper，让 handler 继续只描述意图，不直接访问 app state。
   - command runtime 解释该 effect 时调用 app 注入的窄回调，例如 `clearTranscriptRecords()`。
   - 备选：让 `/clear` handler 通过 context 调 app 方法；这会破坏 handler 只读 context 的边界。
   - 备选：让 `main.js` 对 `/clear` 特判；这会回到每个命令堆积 app 分支的旧模式。

3. **清空 transcript 后走当前 app snapshot 重绘，而不是追加一条“已清空” transcript。**
   - `/clear` 的语义是移除当前 transcript 内容；确认后不应再向 transcript 追加本地 assistant 提示，否则用户看到的 transcript 不为空。
   - app 可以通过 destructive/full snapshot 路径重建可见区域，确保旧 transcript 视觉内容被清除。
   - 如需用户反馈，使用回到空 composer 的 footer 状态和默认 hint；不新增额外 toast 机制。

4. **输入历史必须保留。**
   - `/clear` 自身不进入历史；确认清空也不修改已有 `inputHistory`。
   - 用户清空后按 Up 仍可回到此前成功提交的普通消息。
   - 这与 transcript records 分离：transcript 是当前可见会话内容，input history 是编辑便利能力。

5. **只匹配纯 `/clear`。**
   - 与 `/help`、`/model` 保持一致，`/clear more` 等带后缀内容继续按普通消息提交。
   - 这样避免命令参数语义扩散，也保持 resolver 行为可预测。

## Risks / Trade-offs

- [Risk] 清空 transcript 需要移除旧屏幕投影，普通 footer redraw 不足以清除历史区域。→ Mitigation：清空 effect 由 app 层执行，并使用现有 app renderer 的完整重绘能力重建当前空 transcript snapshot。
- [Risk] 新增 effect type 会让 command runtime 和 app host 依赖增加。→ Mitigation：只新增一个明确语义的 transcript effect，不引入通用 reducer 或任意 app mutation。
- [Risk] `/clear` 确认后没有 transcript 反馈，用户可能想知道操作完成。→ Mitigation：确认后屏幕上的 transcript 消失即为反馈；后续如需要 toast，可另起 change 设计通用临时状态提示。
- [Risk] 清空 transcript 但保留 input history 可能让用户误以为历史也应消失。→ Mitigation：文档和测试明确这两个状态域分离，`/clear` 只清 transcript。

## Migration Plan

1. 新增 `/clear` handler 和清空 transcript effect。
2. 在 command runtime 中解释该 effect，并通过 app 注入的窄回调清空 transcript。
3. 在 `main.js` 中实现清空 transcript records 后的当前 app snapshot 重绘，同时保留 input history。
4. 注册 `/clear` 到默认 slash resolver。
5. 补充 render、command、runtime/app 集成测试和文档。
6. 运行自动化测试、语法检查，并用 `npm start` 手工验证 `/clear` 的确认、取消和历史保留。

## Open Questions

- 无。当前 scope 固定为清空当前进程内 transcript records，并保留 session 输入历史。
