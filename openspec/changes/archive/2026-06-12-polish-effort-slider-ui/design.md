## Context

`/effort` 已经具备完整业务能力：读取当前模型 profile、用 Left/Right 切换推理等级、Enter 覆盖 `reasoning.effort`、Esc 取消，并通过 `scale` command surface 展示。当前 surface 仍偏简单文本 slider，视觉上没有达到用户在 `terminal_reasoning_slider_neon.py` 中展示的 rounded cyan slider 效果。

本变更只复刻 demo 的静态 UI 形态，不复刻 demo 的 raw terminal、按键读取、独立 render loop、额外 h/l/q/space 快捷键或 Python 数据模型。交互仍完全使用现有 TUI input event 和 command runtime。

## Goals / Non-Goals

**Goals:**

- 将 `scale` surface 渲染为接近 demo 的 rounded cyan slider 面板。
- 保留 `/effort` 当前业务语义和按键语义：Left/Right 调整，Enter 保存，Esc 取消。
- 使用大写缩写档位文本：`NONE`、`MIN`、`LOW`、`MED`、`HIGH`、`XHIGH`。
- 在面板左下方显示当前真实 effort value、进度 meter 和 `active` 状态。
- 让 `scale` surface 仍是通用 command surface，不在 footer renderer 中硬编码 reasoning effort 的业务枚举。

**Non-Goals:**

- 不引入第三方 TUI 库。
- 不复刻 demo 的 key reader、raw mode、render loop、`h/l`、`q` 或 Space 确认行为。
- 不展示 demo 的长 hint 文案，例如 “balanced agentic work”。
- 不改变 `/effort` 的配置读写、OpenAI request 或 status line 逻辑。

## Decisions

1. 复刻 demo 的视觉组件，而不是交互逻辑。

   目标结构：

   ```text
   ╭─ /effort · LLMBox GPT5.5 [live] ─────────────────╮
   │                                                   │
   │  ◂ ━━━━━●━━━━━●━━━━━◉─────●─────●─────● ▸        │
   │    NONE    MIN     LOW     MED    HIGH   XHIGH   │
   │                                                   │
   │  medium  ██████░░░░  active                      │
   │  Enter 选择 · ←/→ 移动 · Esc 取消                │
   ╰───────────────────────────────────────────────────╯
   ```

   当前 knob 用 `◉`，其他档位用 `●`；已选轨道用 bright cyan `━`，未选轨道用 dim gray `─`。

2. 使用 RGB 前景色 helper 支持 demo 的 cyan 视觉。

   `src/terminal/ansi.ts` 增加 RGB foreground helper，例如 `rgb(r, g, b, text)`。`renderScaleSurface()` 内部使用固定 cyan palette：deep cyan、bright cyan、rail off、white。该 helper 是通用 ANSI 能力，不绑定 `/effort`。

3. 用 `CommandSurfaceOption.description` 承载 display label。

   `/effort` handler 继续把 `label` 作为真实 value（例如 `medium`），同时把 `description` 设置为大写缩写（例如 `MED`）。`renderScaleSurface()` 优先使用 `description || label` 绘制轨道 labels。这样 footer renderer 不需要知道 `medium -> MED` 的业务映射。

4. scale surface 负责通用 slider visual。

   `ScaleCommandSurface` 不新增 reasoning 专属字段。renderer 可以从 `options`、`selectedIndex`、`leftLabel`、`rightLabel`、`title` 和 `dismissHint` 生成完整面板。左下 meter 使用 `selectedIndex / (options.length - 1)` 计算填充比例。

5. 保持安全宽度约束。

   面板宽度应基于 `safeRenderWidth(width)` 计算，避免写满终端最后一列。窄终端下缩短 track width 并裁剪 label/meter/hint，但不破坏 footer 临时区边界。

## Risks / Trade-offs

- [Risk] RGB true color 在少数终端主题中显示不如 8 色稳定。→ Mitigation：颜色只用于 scale surface 装饰；文本本身仍可读，且 ANSI helper 输出标准 24-bit foreground sequence。
- [Risk] rounded frame 增加 footer 高度。→ Mitigation：`/effort` 是 command surface，短时接管 composer 区域；高度增长只发生在用户主动打开该命令时。
- [Risk] 99% 复刻会让 scale surface 比其它普通 command surface 更突出。→ Mitigation：`/effort` 本身是强度调节控件，增强视觉权重符合语义；不影响其他 surface。
- [Risk] label 对齐在极窄宽度下仍可能拥挤。→ Mitigation：复用 `clampPlainText` 和 `displayWidth`，必要时截断而不是溢出。

## Migration Plan

1. 增加 RGB foreground helper。
2. 调整 `/effort` surface options，传入大写缩写 display label。
3. 重写 `renderScaleSurface()`，生成 rounded cyan slider 面板和 meter。
4. 更新 tests 和 docs/specs。
5. 不需要用户配置迁移；功能和持久化语义不变。

## Open Questions

- 是否后续将 `scale` surface 用于其它命令（如 verbosity/temperature）？本变更只服务 `/effort`，但保留 surface 通用性。
