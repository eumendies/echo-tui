## Context

当前 TUI 有两处响应状态动画：assistant 首字输出前的 thinking pending preview，以及首字输出后贴近 transcript/composer 间隔的 working 行。两者都由 `elapsedMs` 在渲染层推导帧，不持有递增帧计数，也不依赖独立动画对象。

最新交互要求将响应中动画收敛到 status line 的状态段：非响应中仍显示 ready/PLAN；响应中同一位置显示 thinking 或 working，避免额外占用 footer 行高。

现有动画使用单字符盲文旋转帧，行为简单稳定，但与 Echo 的 cyan 声波视觉语言不够一致。新的动画应复刻 echo 主题原型中的中心扩散声场：固定宽度的多 cell 字符串从中心亮起、向两侧扩散、淡出并短暂停顿。

## Goals / Non-Goals

**Goals:**

- thinking 与 working 在 status line 状态段使用同一套 echo wave field 帧，形成统一的响应状态动效。
- 动画保持纯渲染投影：输入仍是 `elapsedMs`，输出仍是 ANSI 字符串。
- 每一帧显示宽度固定，避免 footer 局部重绘时出现水平抖动。
- spinner cell 使用现有 cyan palette 的深浅变化表达强弱，空白 cell 不输出颜色。
- 非响应中 status line 继续显示既有 ready/PLAN 状态段。
- thinking pending preview 不再显示独立 spinner/prefix 行。
- working 继续显示 elapsed time，但显示位置迁移到 status line 状态段。
- thinking/working 文案使用灰色未扫区域、白色过渡区域和 bold white 主扫光，并以中心向两侧扩散的运动方向呼应 echo spinner。
- composer 自带边框，transcript 与 composer 之间使用语义空行分隔，而不是额外实线 divider。

**Non-Goals:**

- 不引入后台线程、自管理终端行、独立动画生命周期或第三方 TUI 库。
- 不改变 spinner timer 的调度频率归属、assistant lifecycle、response lock 或 pending 状态模型。
- 不改变 streaming pending preview、tool call pending preview 或 transcript 渲染语义。
- 不把 demo 原型作为运行时依赖；实现应内化为 TypeScript 渲染层逻辑。

## Decisions

### 1. 使用固定帧表，而不是运行时数学生成

实现应将 echo wave field 固化为常量帧表，例如中心亮起、向外扩散、边缘淡出和空白停顿。这样每帧宽度、字符内容和测试断言都稳定。

替代方案是把原型中的数学生成逻辑搬到运行时。该方案更灵活，但对当前固定动画没有收益，还会增加热路径计算和测试不确定性。

### 2. 抽取共享 spinner 渲染 helper

thinking 和 working 应复用同一套帧选择与着色逻辑，避免多个模块各自维护帧表。helper 可以位于渲染层，并暴露纯函数：根据 `elapsedMs` 返回 plain / ANSI 着色后的 echo spinner field；固定宽度由帧表本身保证。

替代方案是在 status line renderer 中内联帧表。该方案改动更少，但后续调整颜色、节奏或帧宽时容易分叉。

### 3. status line 状态段承载响应中动画

渲染状态应把 `pending.kind === 'thinking'` 投影为 status line activity `thinking`，把存在的 `working` 投影为 activity `working`。working 优先级高于 thinking，因为它代表首字之后的响应中状态。

status line mode 仍保留原有 `thinking`、`streaming`、`tool` 等语义，用于 key hint 和 detail；activity 只替换 ready/PLAN 所在的视觉段。这样不会改变 slash suggestion、tool call preview 或响应锁语义。

替代方案是继续在 footer 中渲染独立 working 行。该方案保留旧布局，但违背“放入 status line”的新要求，也会继续占用 footer 高度。

### 4. 保持 elapsedMs 驱动，使用 80ms 帧间隔

现有系统已经通过 turn context 定时触发 footer 重绘，渲染层根据 `elapsedMs` 计算帧。新动画应沿用该模型。echo wave field 帧包含空白停顿，使用约 12.5 FPS 的 80ms 帧间隔，让 thinking/working 状态反馈更灵敏，同时必须保持帧宽稳定和循环平滑。

替代方案是为 echo spinner 单独创建动画 clock。该方案会破坏现有渲染边界，也不符合当前“状态可重算”的架构。

### 5. loudness 到 cyan 渐变的映射在渲染层完成

帧字符可使用从弱到强的 ramp，例如空白、浅噪声、中噪声、亮块。渲染时根据字符强度把非空 cell 映射到 cyan 深色到亮色之间，保持和 footer 其他 cyan 控件一致。

替代方案是所有 cell 使用同一个 cyan。该方案仍可表达位移，但失去“声场强弱”的层次。

### 6. 文案扫光从中心向两侧扩散

status line activity 文案应使用灰色作为未扫到字符底色，并按 echo spinner 的完整帧周期推导当前扫光半径。扫光从文案中心字符或中心双字符开始，逐帧向两侧扩散；当前扫光半径使用 bold white，前后相邻半径使用 white 作为过渡，其余字符使用 gray。spinner 的空白暂停帧期间，文案也保持全灰静默，避免 spinner 已暂停但文字仍在运动。每个字符独立闭合 ANSI，避免影响后续 status segment。

替代方案是恢复旧的左到右 shimmer。该方案能表达活跃状态，但运动方向与新的中心扩散 spinner 不一致。

## Risks / Trade-offs

- 多 cell spinner 比 ready/PLAN 更宽 → 通过固定宽度和现有 safe render width 裁剪控制，必要时优先保留左侧模型/目录信息。
- 空白停顿帧可能被误认为卡住 → 保留工作文案和 elapsed time，且停顿帧数量应较少。
- thinking 不再有独立 preview 行 → 测试应覆盖 thinking pending 不额外插入行，status line 仍显示 thinking 动画。
- ANSI 着色可能影响宽度计算 → 测试应同时检查 plain text 和 `displayWidth` 的稳定性。
- 未扫到字符如果也使用白色会削弱扫光辨识度；只有灰白两档又会显得生硬 → 使用 gray / white / bold white 三层扫光，既保留对比也保留过渡。
- 过度抽象会扩大改动面 → helper 只承载帧表、帧选择和 loudness 着色，不引入可配置主题系统。
