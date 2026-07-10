## Context

当前 TUI 不使用 alternate screen，footer 是唯一会被频繁局部清理和重绘的临时区域。`createFooterRenderer` 记录上一帧 footer 的逻辑高度和光标行，下一帧通过相对光标移动逐行 `clearLine` 清理旧 footer。

这个方案要求上一帧 footer 的全部物理行仍在可见屏幕内。现在只有 streaming pending preview 会根据 `rows` 做限高；command surface、choice surface、tool call pending、slash suggestions 和 composer 都可能生成任意高度。长 bash 审批会同时出现长 `tool_call` pending 和长 approval message，因此最容易把 footer 顶进 scrollback。

## Goals / Non-Goals

**Goals:**

- 将 footer 总高度限制为终端高度减去顶部两行 padding，保证 footer 不把自己的顶部写进 scrollback。
- 让所有 footer 内容入口共享同一个高度预算模型，而不是只修高危 bash approval 单点。
- 在高度不足时优先保持可交互元素可见：composer 光标、choice 当前选项、内联输入光标、surface 操作提示。
- 保持当前终端模式、ANSI 局部重绘和 destructive resize recovery 的既有架构。

**Non-Goals:**

- 不引入 alternate screen、滚动区域控制、全屏 modal 或第三方 TUI framework。
- 不改变 transcript、tool approval 决策、provider 请求、持久化 session 或用户配置格式。
- 不为 footer 内容提供完整可滚动历史；被裁剪的 footer 内容仍可通过 transcript/tool result 或模型上下文语义保留，而不是在 footer 中完整展示。

## Decisions

### 1. 在 `renderFooterLayout` 建立全局 footer 高度预算

`renderFooterLayout` SHALL 使用 `rows` 计算 `maxFooterHeight = max(1, floor(rows) - 2)`。所有 pending、working、divider 和 input surface 最终合并后的行数不得超过该预算。`rows` 不可用时保留现有默认终端行数语义。

选择这个位置是因为它能看到完整 footer 组成，适合作为最终不变量边界。替代方案是在每个 surface 内独立读取 terminal rows，但那会让预算分散，容易遗漏新 surface。

### 2. 先预算交互区，再把剩余空间给 pending preview

footer 的交互区包括 composer 或 command surface；它决定用户当前能否继续输入、审批或选择。实现应先给 input surface 一个可用高度，再使用剩余高度渲染 pending preview。working line 和 divider 是固定结构，应在预算中明确扣除。

如果 input surface 本身已经吃满预算，pending preview 可以被压缩到 0 或最小摘要，而不是让 input surface 不可操作。

### 3. Composer 使用光标附近 viewport，不显示省略提示

普通 composer 渲染完整逻辑行后，在高度受限时只保留包含当前光标行的窗口。窗口可以偏向底部，使持续输入时新行自然把顶部旧行挤出。裁剪后必须重新计算 `cursorRow`，并且不显示 `...` 或 `…` 隐藏提示。

这样符合用户期望：composer 是编辑区而不是阅读区，最重要的是光标可见和局部重绘稳定。

### 4. Choice surface 采用结构优先的裁剪顺序

choice surface 在预算内应优先保留标题、当前选项、内联输入光标和操作提示。message 作为说明内容可以被截断；options 过多时应围绕 selectedIndex 窗口化，保持调用方原始顺序，不重新排序。

高危 bash approval 的长 command preview 属于 message 内容，允许被截断或摘要化；但标题、至少一个风险原因和安全决策选项必须仍可见。

### 5. `tool_call` pending preview 接受最大行数预算

当前 streaming pending 已经按 `maxLines` 保留尾部或摘要；`tool_call` pending 也需要同类预算。长 bash 命令、长 JSON arguments 或未知工具 fallback 不得绕过 footer 全局高度限制。

### 6. 保留最终兜底裁剪

即使各 surface 都接受预算，`renderFooterLayout` 仍应在返回前执行最终行数兜底，保证任何遗漏或未来新增 surface 都不会违反 `rows - 2`。兜底必须尽量保持 cursor row 合法；如果裁掉了 cursor 所在行，应把 cursor 收敛到最后一行或可见交互行。

## Risks / Trade-offs

- 长审批 preview 被截断可能减少一次性可见上下文 → 保留标题、风险原因和命令开头，必要时显示截断摘要；完整 command 仍来自 tool call 数据，不改变执行语义。
- 极小 terminal rows 下无法同时显示所有交互元素 → 优先保证不进入 scrollback，其次保证当前选中项和确认/取消提示尽可能可见。
- 多个 surface 各自裁剪可能产生不一致视觉 → 由 `renderFooterLayout` 提供统一预算入口，并通过测试覆盖各类 surface。
- 最终兜底裁剪可能掩盖某个 surface 的预算 bug → 测试应直接覆盖 source surface 的预期窗口化行为，而不仅断言总高度。

## Migration Plan

这是纯渲染行为变更，无数据迁移。发布后旧 transcript 和 persisted sessions 会继续按当前记录内容重新投影，只是 footer 临时区域在小窗口或长内容下会显示更少行。

回退策略是恢复旧的 footer layout 生成逻辑；因为不改变持久化或 provider 协议，回退不需要清理用户数据。

## Open Questions

- 极小 rows 下是否需要隐藏 divider 或 working line 来保留更多交互区？第一版可以保持 divider 固定，只有在测试发现无法满足最小交互可见性时再调整。
