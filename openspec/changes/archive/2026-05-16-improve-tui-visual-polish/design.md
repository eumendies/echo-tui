## Context

当前 TUI 已经具备 append-only transcript、footer 局部重绘、composer 输入和 mock assistant streaming。问题集中在视觉呈现：pending assistant 和最终 assistant block 布局不一致，`user:` / `assistant:` 文本标签显得笨重，banner 与 hint 的信息层级还可以更克制。

这次变更只处理视觉层和 spinner 状态，不改变输入模型、agent mock 语义、append-only transcript 或当前终端运行约束。

## Goals / Non-Goals

**Goals:**
- 统一 user transcript、assistant transcript 和 assistant pending preview 的消息布局。
- 移除 transcript 中显式 `user:` / `assistant:` 文本标签，使用符号和颜色区分角色。
- 让 pending assistant streaming 和完成后的 assistant transcript 使用相同起始列，避免完成瞬间跳版。
- 在 assistant thinking 期间显示 spinner 动画，保持用户能看到系统仍在工作。
- 优化 banner 和 hint 的视觉层级，让它们更像工具状态信息，而不是装饰块。
- 保持 ANSI 样式不参与 display width 计算，避免彩色前缀破坏 wrap 和光标坐标。

**Non-Goals:**
- 不修改 composer 编辑能力、快捷键或字符级光标模型。
- 不接入真实 LLM。
- 不引入第三方 TUI 库、动画库或渲染框架。
- 不把 transcript 改成全屏重绘或 alternate screen 模式。

## Decisions

### 使用符号前缀替代文字标签

用户 transcript 使用与 composer prompt 一致的 `>` 前缀，assistant 完成消息使用 `◆` 前缀，assistant pending 使用 `◇` 前缀。

- 理由：符号占用更少空间，降低重复标签噪音，并且和 composer 的 `>` 有视觉区分。
- 备选方案：继续使用 `user:` / `assistant:` 并调整颜色。拒绝原因是标签仍然过重，且无法解决用户提出的专业感问题。

### 统一消息布局函数

新增或调整统一的消息行布局逻辑：第一行是 `prefix + space + text`，后续行按文本起始列缩进。

- 理由：pending preview 和最终 transcript 共享布局后，assistant streaming 完成时只需要从 `◇` 变成 `◆`，不会发生文本换行或缩进跳变。
- 备选方案：分别维护 pending 和 final 渲染。拒绝原因是当前问题正来自两套布局不一致。

### 颜色和宽度计算分离

layout 计算使用纯文本 prefix 和内容；颜色只在生成最终输出字符串时应用。

- 理由：当前 `displayWidth()` 不解析 ANSI escape sequence。如果带颜色字符串参与宽度计算，会导致 wrap 和 cursor 位置错误。
- 备选方案：实现 `stripAnsi()` 后允许彩色字符串进入 layout。当前范围内不需要，且会增加复杂度。

### thinking spinner 由 app 层状态驱动

app 层在 assistant thinking 阶段启动一个短间隔 timer，更新 pending preview 的 spinner frame；streaming 开始或完成时停止 timer。

- 理由：footer renderer 只负责渲染状态，不负责管理时间。app 层已经掌握 assistant lifecycle，适合驱动 spinner。
- 备选方案：把 spinner timer 放进 fake agent。拒绝原因是 agent 应保持 adapter 语义，避免掺入 UI 呈现。

### banner 和 hint 降低装饰权重

banner 保留 session 信息，但减少重边框感；hint 保持一行 dim 状态栏。

- 理由：banner 是启动信息，不应抢占 transcript 和 composer 的视觉焦点。
- 备选方案：保留盒式 banner。拒绝原因是当前用户反馈样式不够专业。

## Risks / Trade-offs

- ANSI 样式影响宽度计算 -> layout 使用未上色文本，渲染阶段再给 prefix 上色。
- spinner timer 泄漏 -> 在 streaming 开始、assistant 完成、退出 cleanup 时清理 timer。
- 符号在部分字体中显示宽度不一致 -> 选择常见单宽符号，手动验证主流终端显示。
- 用户消息灰色背景过重 -> 只对前缀或短范围应用克制背景/灰色强调，不铺满整行。
- 视觉调整主观性强 -> 以“布局稳定、低噪音、可扫描”为验收标准，而不是装饰复杂度。
