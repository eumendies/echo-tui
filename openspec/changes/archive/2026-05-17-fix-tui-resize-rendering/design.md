## Context

当前实现已经从“footer-only redraw”进化到了“整段 app-owned region redraw”：应用持有 transcript records，并在 resize 时重新投影 banner、transcript 和 footer。但长消息 + 任意列宽变化仍然会击穿这个模型，因为终端会先把旧输出按新宽度重新折行，应用再试图沿着旧逻辑高度回退清理时，就无法可靠知道“旧屏幕到底变成了多少物理行”。

之前探索过 bounded viewport / live region，试图通过缩小 renderer 的 ownership 规避 scrollback 边界；但对于这个原型来说，这会把“默认看全部历史”“banner 生命周期”“未来历史浏览交互”一起改掉，超出当前 change 的问题范围。既然产品上接受更强的恢复语义，更直接的办法是：把任意列宽变化都明确视为 destructive recovery 事件，直接清 screen 和 scrollback，再从当前状态重绘一份自洽快照。

正确边界因此变成：

- transcript 内容语义 append-only，渲染结果可以重算；
- 只要列宽变化，应用都不再尝试修复旧 screen，而是销毁旧 screen，重建新 screen。

## Goals / Non-Goals

**Goals:**

- 建立 transcript records，保存 user/assistant 等已提交消息的结构化内容。
- 基于 transcript records 重新渲染完整 app snapshot，而不是把历史 ANSI 输出当作唯一状态。
- 在任意列宽变化时允许 destructive clear：清可见屏幕、清 scrollback、回到左上角后完整重绘。
- 让列宽变化的恢复路径不再依赖旧输出物理行数估算。
- 保持启动 banner、transcript、pending、divider、composer 和 hint 在 destructive repaint 后形成一份完整、自洽的当前屏幕快照。
- 保留用户消息整行灰色背景，并在 resize 后按当前宽度重新覆盖每一行。
- footer divider 在 resize 后始终保持单行，不产生多行残留。
- footer 和 transcript 的 wrap、indent 在宽度变化后重新计算，中文宽字符不破坏列宽。
- streaming 中 resize 不破坏 pending preview、divider、composer、hint 和光标位置。
- 为后续工具调用消息、详情展开/收起等能力留下结构化渲染入口。

**Non-Goals:**

- 不引入 alternate screen、全屏清空或第三方 TUI 库。
- 不保留列宽变化发生前用户终端里的 visible screen 或 scrollback 历史；这次 change 明确允许清理它们。
- 不改变输入快捷键、mock assistant 内容或 response lock 语义。
- 不在本 change 实现工具调用消息或展开/收起交互，只为这些能力保留渲染模型。
- 不要求所有 resize 都走 destructive clear；纯高度变化和普通状态更新仍可保留较轻的 redraw 路径。

## Decisions

### 1. append-only 约束落在内容记录，不落在 ANSI 输出字节

app 层维护 `transcriptRecords`，例如 `{ role: 'user', text }` 和 `{ role: 'assistant', text }`。提交时只追加记录；assistant 完成时只追加完成记录。resize、输入编辑和 streaming 触发的是 render projection 重新生成，不改变 records。

备选方案是继续只追加 ANSI 字符串。这个方案实现更小，但无法修复整行背景变宽后的补齐问题，也无法支撑未来工具详情折叠。

### 2. 任意列宽变化都触发 destructive recovery，而不是继续猜旧输出高度

应用维护上一次 terminal 列宽。只要检测到 `newColumns !== previousColumns`，就进入 destructive recovery 分支：重置滚动区域与文本样式、清可见屏幕、清 scrollback、把光标移到左上角，再根据当前状态完整输出新的 app snapshot。

这样做的关键是：应用不再需要知道旧输出被终端 reflow 成了几行，因为旧输出会被整体销毁。对于这个原型来说，这比引入 viewport 模型更直接，也更符合“先消灭 resize 残影”的目标。

### 3. destructive repaint 输出完整 app snapshot，而不是局部 live region

shrink 恢复后的屏幕应该是一份完整快照，至少包含 banner、transcript projection、pending preview、divider、composer 和 hint。因为旧 screen 与 scrollback 已被清掉，banner 不必再与 live redraw 边界做特殊切分；它可以重新成为完整快照的一部分。

这意味着 banner 在“启动时首次输出”和“shrink 后恢复重绘”这两个时点都会出现，但 shrink 路径前会先 clear screen + clear scrollback，因此不会产生视觉上的重复 banner。

### 4. footer renderer 与 transcript renderer 共享宽度 helper

在 `layout.js` 中集中提供安全宽度 helper，例如 `safeRenderWidth(width)`。divider、composer、pending preview、user/assistant blocks 都使用同一宽度来源，避免某些模块按 `columns`、某些模块按 `columns - 1` 产生错位。

destructive repaint 虽然不再需要估算旧输出高度，但新快照里的 wrap、背景宽度、composer 光标列和 divider 宽度仍必须共享同一套宽度计算。

### 5. 用户消息保留整行背景，但只在投影阶段计算

用户消息仍用 `>` 前缀和整行灰色背景。区别是背景不再是“提交时永久写死的宽度”，而是在每次 render projection 时根据当前安全宽度重新 pad。多行文本按当前宽度重新 wrap，后续行按文本列缩进，并整行覆盖背景。

备选方案是只给前缀上背景。这个方案 resize 简单，但视觉效果弱，也不符合后续更丰富消息块的需求。

### 6. 普通 redraw 与 destructive recovery 走同一个 render 入口，但带不同模式

应用仍然应该保留统一 render 入口，这样 composer 编辑、thinking spinner、streaming token、completion 和 resize 都共享同一份状态投影逻辑。区别只在于 render mode：

- 普通模式：沿用当前较轻的 redraw/clear 方式；
- destructive recovery 模式：只要列宽变化就先做 destructive clear，再输出完整快照。

这样可以避免把“什么时候需要完全清场”分散到多个模块里，也能减少局部 renderer 交错写 stdout 的风险。

### 7. destructive recovery 允许清 scrollback，这个代价是显式接受的

这次 change 明确接受 `ESC[3J]` 一类清 scrollback 语义。也就是说，列宽变化后的恢复不是“修当前画面”的温和重排，而是“销毁旧终端历史并重建当前画面”的强恢复动作。

这与 alternate screen 不同：应用仍然运行在主终端中，但一旦 shrink 发生，主终端的当前 screen 与 scrollback 可以被应用接管并清理。这个 trade-off 需要在文档里明确说明，并在验证中重点覆盖常用终端兼容性。

## Risks / Trade-offs

- [Risk] 任意列宽变化都会清用户当前终端的 visible screen 和 scrollback。→ 明确把它定义为 destructive recovery；在 proposal、spec 和 README 中都直接写清楚，不隐含这个代价。
- [Risk] `ESC[3J]` 在不同终端、tmux 或 IDE terminal 中的兼容性可能不完全一致。→ 验证覆盖 iTerm2 / macOS Terminal 等主用终端，并把不保证一致的环境记录为兼容性边界。
- [Risk] shrink 时整屏重绘可能带来 flicker。→ 因为该路径只在 width 变小的高风险事件触发，接受这点视觉代价，优先换稳定性。
- [Risk] 清 scrollback 后，用户不能再依赖终端历史回看 shrink 之前的输出。→ transcript records 仍保留在 app 状态中；如未来确实需要历史浏览，再单独设计 app 内部历史查看能力。
- [Risk] 中文宽字符和 ANSI 背景混用容易错位。→ 所有 wrap、padding、cursor 计算继续基于 `displayWidth`，验证必须覆盖中文长文本。
