## Context

当前 app 在 `onToolCall` 回调中立即追加 `tool_call` transcript record，renderer 随即把它写入 transcript/scrollback 区域；`tool_result` 到达后再追加另一条记录。这个模型对 provider continuation 是正确的，但对 TUI 可见状态不够理想：进入 transcript 区域的内容不能像 footer 一样稳定局部重绘，因此不适合承载“工具执行中”的临时状态。

现有 TUI 已经把 thinking 与 streaming draft 放在 footer pending preview 中，并在完成后才把 assistant 消息落到 transcript。工具调用执行中状态也应遵循同样边界：未完成时属于 footer 临时状态，完成后再进入 transcript。

## Goals / Non-Goals

**Goals:**

- tool call 到达时先在 footer pending 区域显示工具调用预览，不立即写入 transcript 区域。
- tool result 到达后，仍按既有记录类型追加 `tool_call` 与 `tool_result` 两条 transcript record，保持持久化和历史 session 兼容。
- 根据相邻 `tool_result.ok` 对 `tool_call` 行的 `◆` prefix 做成功/失败着色，旧记录或缺少状态的记录保持安全 fallback。
- 增加 working spinner：从本轮首个 assistant token 到达到本轮完成或失败结束之间显示，并展示本轮已耗时。
- working spinner 固定渲染在 footer pending preview 下方、divider 上方，并紧贴 divider。
- 不新增 app/runtime 类；优先扩展现有 `TurnContext` 状态、`PendingState` 和 `RenderState`。

**Non-Goals:**

- 不改变 agent loop runtime 的 continuation `TranscriptRecord[]` 维护方式。
- 不改变 provider agent、tool executor 或具体 tool handler 的执行契约。
- 不新增 `tool` transcript role，也不迁移既有 session 持久化格式。
- 不在工具执行中进入 alternate screen 或对已进入 scrollback 的历史区域做回改。

## Decisions

### 1. tool call pending 化，而不是立即 append transcript

`onToolCall` 只更新当前 pending 状态，例如 `{ kind: 'tool_call', toolName, argumentsText }`，并触发 footer redraw。`onToolResult` 到达后，再由 app/turn 层基于暂存的 tool call 构造原有 `tool_call` record，然后追加 `tool_result` record。

理由：footer 是当前架构中唯一可稳定局部重绘的临时区域；把未完成工具调用放在 footer 可以避免回改 transcript/scrollback。

替代方案是继续立即 append `tool_call`，并在 result 到达后 destructive replay 合并显示。该方案会引入清屏/scrollback 破坏，和现有只在 resize recovery 使用 destructive replay 的策略不一致。

### 2. 保留既有 transcript record 类型

完成后仍追加 `tool_call` 和 `tool_result` 两条记录，不新增 `tool` role。renderer 层使用批量 append 一次性投影相邻 call/result，使 call 行可以读取 result 状态给 `◆` 着色；这只是渲染优化，不改变 transcript schema。

理由：provider input 转换、session persistence、历史恢复和已有测试都围绕 `tool_call`/`tool_result` 工作。保留类型能把本次变更限制在 app 可见时序和 render 投影上。

### 3. working 独立于 pending 内容

新增 working render state，例如 `{ frame, elapsedMs }`，独立于 `pending`。`pending` 表示临时内容（thinking、streaming draft、tool call preview），`working` 表示本轮响应已经进入首字之后的持续工作状态。

working 从首个 token 到达时开始，到本轮 complete 或 fail 时结束；工具调用、工具执行、continuation 请求期间保持显示。它渲染在 pending preview 下方、divider 上方，并紧贴 divider。

### 4. 成功/失败颜色由相邻 result record 决定

tool call renderer 在相邻 `tool_call + tool_result` 投影时使用 result 的 `ok` 决定 call 行 `◆` 颜色。成功使用成功色，失败使用错误色；缺少 `ok` 或没有相邻 result 的历史 record 保持中性 fallback。tool result 的 `⎿` 输出行继续使用中性灰色，避免把输出文本本身当成状态提示。

## Risks / Trade-offs

- [Risk] `onToolResult` 需要找到之前暂存的 tool call；如果回调乱序或缺失，可能无法生成对应 call 行。→ 保留 fallback：没有暂存 call 时仍可按旧方式追加 result record。
- [Risk] 连续追加 `tool_call` 和 `tool_result` 可能导致 call 行无法读取 result 状态。→ 使用批量 append 一次性渲染相邻 call/result，但仍按既有 transcript schema 保存两条 record。
- [Risk] working spinner 从首字 token 后才显示，首字前仍只有 thinking spinner。→ 这是有意区分：thinking 表示等待首字，working 表示已经开始产出或执行后续工作。
- [Risk] footer 高度增加一行可能影响小终端可见空间。→ working 行纳入 footer layout 高度预算，并保持单行紧凑显示。
