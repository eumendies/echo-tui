## Context

普通 footer 当前由 divider、裸 composer 文本行、可选 slash suggestions 和一行 status line 组成。最近加入 context usage 后，status line 承载的信息更多：模型、推理等级、目录、mode、context usage 和快捷键提示都挤在一条线性文本里。

用户提供的 demo 展示了两个方向：composer 使用 cyan rounded box，status line 使用左右分组的 segmented 单行状态条。项目已有 `/effort` scale surface 使用 cyan gradient 和 RGB 轨道点；status line 的 effort segment 使用固定 cyan 圆点，避免把普通状态条耦合到 `/effort` slider 的档位配色。

## Goals / Non-Goals

**Goals:**

- 普通 composer 使用顶满终端安全宽度的 cyan 边框输入框，保留当前 `> ` 前缀和现有输入/换行/光标语义。
- 空 composer 在框内显示辅助 placeholder，包含 `/` 命令、`Ctrl+J` 换行和 Enter 发送提示。
- status line 改为 segmented 单行：左侧模型、effort、目录；右侧 context usage 和 ready/plan/pending 状态。
- effort 从模型 label 中拆出，作为独立 segment，圆点使用固定 cyan accent。
- 保持 command/approval/user-question surface 替换普通输入区域，不改变 agent、transcript、session 或 provider 行为。

**Non-Goals:**

- 不显示 git branch。
- 不引入第三方 TUI 库、不切换 alternate screen、不改变 raw mode 输入解析。
- 不改变 `/effort` 命令的交互模型，也不要求 status line 复用 slider 档位颜色。
- 不把 placeholder 文案写入 composer 状态、transcript 或 input history。

## Decisions

### Decision: 在 footer renderer 内实现 boxed composer

普通输入态的视觉变化属于 footer projection，不应改变 composer 编辑模型。renderer 可以把现有 `ComposerState` 投影为：顶部边框、1 到 N 行文本内容、底部边框，并把原有 cursor row/column 加上边框和 padding 偏移。

替代方案是修改 `renderComposer()` 的基础布局函数，让所有调用方都得到 boxed composer。该方案耦合更强，也会让普通文本 composer 与 box 渲染难以区分。优先采用 footer-local 投影或明确命名的新 helper，保持编辑模型不变。

### Decision: placeholder 是渲染态，不进入 composer state

placeholder 只在 composer 为空时显示在框内，使用 dim 样式并保留 `> ` 前缀。用户开始输入后 placeholder 消失；提交、历史浏览、slash suggestion 匹配都仍基于真实 composer text。

替代方案是把 placeholder 当作 composer 内容填充。该方案会污染输入编辑、历史和 slash command 识别，因此不采用。

### Decision: status line 使用左右分组 segmented renderer

status line 左侧承载稳定身份信息：模型、effort、目录；右侧承载动态状态：真实 context usage 和 ready/plan/pending 状态。两组之间用空白填充，在宽度不足时优先保留左侧，再整体丢弃或裁剪右侧，保持单行。

替代方案是继续线性拼接 `·` 分隔文本。该方案实现最小但无法形成清晰信息层级，也不匹配 demo。

### Decision: status line effort 使用固定 cyan

status line 的 effort segment 只承担“当前模型显式配置了某个 effort”的信息提示，不需要表达 slider 档位强弱。固定 cyan 圆点与状态条整体视觉保持一致，并让 `/effort` slider 的档位颜色逻辑留在 slider renderer 内部。

替代方案是抽取共享 helper，让 slider 和 status line 使用同一档位颜色。该方案会让普通 status line 依赖 slider 的视觉语义，且用户已明确不需要，因此不采用。

### Decision: 快捷键提示从 status line 迁移到 placeholder

普通 idle 状态下，`/` 命令、`Ctrl+J` 换行和 Enter 发送更接近输入辅助信息，放在空 composer placeholder 内更自然。status line 保留状态信息；当 slash suggestion、pending 或 command surface 活跃时，既有 key hint 仍由对应状态或 surface 自身提示表达。

替代方案是 status line 和 placeholder 都显示快捷键提示。该方案重复信息并挤占状态条空间，不采用。

## Risks / Trade-offs

- [Risk] boxed composer 增加 2 行 footer 高度，streaming pending preview 可用高度减少。→ 继续依赖现有 `inputSurface.lines.length` 预算，更新测试覆盖多行 composer 与 pending preview 高度。
- [Risk] cursor row/column 偏移错误会导致输入光标错位。→ 用 footer layout 单元测试覆盖空输入、普通输入、多行输入和 wrap 后的 cursor 坐标。
- [Risk] ANSI truecolor segment 宽度计算不准确会导致 status line 超宽换行。→ 所有拼接后用现有 `displayWidth()` / `safeRenderWidth()` 计算，窄屏测试验证不写满最后一列。
- [Risk] effort 从 `modelLabel` 拆出会影响既有测试和状态派生。→ 更新 `StatusLineState`，让模型 label 只表示模型，reasoning effort 独立传递。
