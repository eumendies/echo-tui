## Context

当前 `main.js` 在 thinking 阶段通过 `spinnerIndex` 定时更新 `pending = { text: "<frame> thinking..." }`，render 层只把这段字符串当普通 pending 文本投影到 footer。这个模型的优点是简单，但它把 thinking 的视觉表达压扁成了单一字符串：

- render 层无法安全地区分 spinner glyph、label 和 dots；
- 不能在最终投影阶段按字符做 shimmer；
- 如果直接把带 ANSI 的富文本塞进 `pending.text`，当前 `blocks.js` 的按字符 wrap 逻辑会把 ANSI 控制序列当普通字符处理，导致宽度估算和窄宽度换行不可靠。

你提供的 Python demo 说明目标效果并不只是“多转一种 spinner”，而是要形成一个稳定的 thinking 视觉单元：`spinner glyph + shimmer label + animated dots`。这要求上层状态和下层投影之间重新建立明确边界。

## Goals / Non-Goals

**Goals:**
- 把 thinking pending preview 从扁平字符串升级为结构化 display state，使 renderer 能在最终投影阶段生成 shimmer 效果。
- 保持 streaming draft 仍然沿用普通文本 pending preview，不把 thinking 动画模型扩散到所有 pending 状态。
- 保证 thinking → streaming 的切换不改变 pending preview 的起始列、换行规则和 footer-only redraw 语义。
- 在窄终端下安全降级，避免 ANSI 富文本被 wrap 逻辑切碎。

**Non-Goals:**
- 不把 spinner timer ownership 从 app 层迁走；本次只升级 display state 形态和 render 投影。
- 不改变 transcript append、resize destructive replay、composer 编辑和 fake agent 生命周期。
- 不引入 truecolor、第三方动画库或更复杂的富文本排版系统。

## Decisions

### Decision: pending preview 升级为结构化 display state
thinking 阶段不再把 `pending` 表示为单个文本字符串，而是升级为带 kind 的结构化状态，例如：

- `pending = { kind: 'thinking', frame: number }`
- `pending = { kind: 'streaming', text: string }`

这样 app 层只表达“当前是 thinking 的第几帧”或“当前 streaming draft 是什么”，而 renderer 再决定如何把它投影成视觉文本。

选择这个方案而不是继续用 `pending.text` 拼接 ANSI 的原因：现有 `renderPendingAssistantLines` 会按字符遍历内容来做 wrap，直接混入 ANSI escape sequence 会污染宽度计算和断行逻辑。

备选方案：继续使用 `pending.text`，只在 `main.js` 内拼接带 ANSI 的 shimmer 字符串。放弃原因是会让 app 层承担富文本拼装，且在窄宽度和多行场景下不稳。

### Decision: shimmer 由 render 层在 thinking 专用投影函数中生成
render 层新增 thinking 专用的 pending 投影路径，由它根据 `frame` 生成：

- 当前 spinner glyph；
- `thinking` label 上的亮点 sweep；
- 轻量 dots 动效。

投影时仍然先基于未上色文本做宽度与换行决策，再在最终输出阶段按字符附加 ANSI 样式，保证 shimmer 不改变逻辑布局。

备选方案：在 `blocks.js` 里统一把所有 pending 文本都改为富文本 token 流。放弃原因是 streaming draft 不需要这么复杂的表示，会无谓扩大改动面。

### Decision: thinking 和 streaming 保持两条明确的 pending 渲染分支
thinking 与 streaming 在 display state 上明确区分：

- `thinking`：动画状态，使用 shimmer label；
- `streaming`：事实草稿文本，继续走纯文本 pending preview。

这样可以保持流式正文的可读性，也让“streaming 开始后停止 spinner”这条现有 requirement 更自然：一旦收到第一 token，就从 thinking state 切换到 streaming state，不再尝试在 draft 上附加 shimmer。

备选方案：让 streaming 的前几个 token 也继续沿用 shimmer。放弃原因是它会削弱“进入真实输出”的语义切换，也更容易引起文本跳变感。

### Decision: 窄宽度下允许视觉降级，但不允许布局出错
thinking shimmer 的首要约束是安全，而不是满配动画无论多窄都完全呈现。实现上允许在极窄宽度下做降级，例如减少 dots、缩短 label 或退回更简单的亮暗变化，但必须满足：

- 不输出被截断的 ANSI 控制序列；
- 不破坏 pending preview 的缩进和换行；
- 不让 shimmer 导致多余的布局跳变。

备选方案：强制所有宽度都展示完整 `thinking...` shimmer。放弃原因是它会把视觉表达优先级置于布局安全之上。

## Risks / Trade-offs

- [Risk] `pending` 数据形态变化会波及 `main.js`、`app-renderer`、`footer` 和相关测试 → Mitigation：只引入最小的 `kind` 区分，不把整个 pending 流程重构成新的状态机。
- [Risk] shimmer 需要按字符着色，容易和 wrap 逻辑打架 → Mitigation：先按纯文本内容计算行，再在最终行输出阶段附加 ANSI 样式。
- [Risk] 视觉增强可能在某些终端主题下对比度不足 → Mitigation：优先使用现有 ANSI 基础样式（bold/dim/cyan），避免依赖高风险色值。

## Migration Plan

1. 把 app 层的 thinking / streaming pending state 改为结构化表示。
2. 在 render 层增加 thinking shimmer 的专用投影逻辑，并保持 streaming 走原有文本路径。
3. 更新测试，覆盖结构化 state、thinking → streaming 切换和窄宽度安全性。
4. 手动观察实际终端效果，确认 shimmer 提升视觉层次但不破坏 footer-only redraw。

## Open Questions

- shimmer label 最终使用 `thinking` 还是 `working`？当前 proposal 默认沿用现有语义 `thinking`，但如果你想贴近 demo 的 `working`，需要在实现前再定一次文案。
