## Context

当前 footer 普通 composer 区域由 composer 行、slash suggestions 和一行静态 hint 组成。hint 在 `main.ts` 中以固定字符串传入 render state，渲染层只负责弱化显示。这个设计简单，但无法展示当前项目、模型响应阶段、tool pending 或 slash command 等动态上下文。

status line 的目标是复用现有 hint 占用的最后一行，不增加 footer 高度，同时让底部区域成为稳定的上下文摘要。command/choice/confirm/info surface 已经各自拥有 `dismissHint`，它们的提示语义更接近 modal 内部操作，不应被全局 status line 替代。

## Goals / Non-Goals

**Goals:**

- 用结构化 status line 替换普通 composer 下方的静态 hint。
- status line 优先展示当前选择的模型，并继续展示项目名、当前 mode 和当前上下文中不容易自然发现的操作提示。
- 根据 render state 推导 idle、slash command、thinking、streaming、tool pending 等 mode。
- 保持 footer 局部重绘、destructive resize recovery 和 cursor 还原语义稳定。
- 保持 command surface、choice surface、confirm surface 和 info surface 的 `dismissHint` 行为不变。

**Non-Goals:**

- 不引入 git branch、token usage 或完整 cwd。
- 不把现有 working spinner 行合并进 status line。
- 不增加新的异步状态查询或第三方 TUI 依赖。
- 不改变 command surface 或 choice surface 的布局和交互提示。

## Decisions

1. **将 status line 建模为 render state 的结构化状态**

   使用类似 `StatusLineState` 的类型承载 `projectName`、`modelLabel`、`mode`、`detail` 和 `keyHint`。相比继续传 `hint?: string`，结构化状态能让渲染层明确区分项目、模型、上下文状态和快捷键。

2. **第一版只替换普通 composer surface 的 hint 行**

   `renderComposerSurface` 渲染 composer、slash suggestions 和 status line。`renderCommandSurface` 分支继续由各 surface 自己处理 `dismissHint`，避免 tool approval、ask_user_questions 或 slash command 的 modal 提示被全局规则覆盖。

3. **mode 从已有 render state 推导，模型信息复用 `ModelContext`**

   渲染组装层可以根据 `pending`、`working`、`slashSuggestions`、`commandSurface` 等已有状态决定 mode。当前模型使用 `ModelContext.getModelInfo()` 已有同步读取能力，并取 `models[selectedIndex]` 的 `label` 作为优先展示值；当 label 不可用时可退回 `model` 或 profile id。渲染层只消费已组装好的 status line 状态，不直接读取模型配置。

4. **项目名使用 cwd basename**

   banner 已显示完整 cwd，status line 只需要一个短项目标识。使用当前 cwd 的 basename 可以避免长路径挤压快捷键，同时不需要额外配置。

5. **宽度不足时整体裁剪**

   status line SHALL 使用现有 display width/clamp 工具限制到 safe render width。第一版不做复杂右对齐，按模型、项目、mode/detail 和 key hint 顺序使用简单分隔符连接；模型信息作为首段并使用强调颜色，确保窄宽度下也优先保留。key hint 只保留 `/` 命令入口、`Ctrl+J` 换行、slash suggestion 操作和响应中退出等不够显而易见的提示，不重复展示 Enter 发送这类基础操作。

## Risks / Trade-offs

- **状态栏过宽导致换行** → 使用 safe width 裁剪，保守少用终端最后一列。
- **动态 mode 与 modal 提示冲突** → 只在普通 composer surface 显示 status line，modal surface 保持 `dismissHint`。
- **状态信息过多造成噪声** → 第一版只显示当前模型、项目名、mode 和快捷键，不加入 git/token 等额外信息。
- **测试快照变化较多** → 更新 footer layout 和 app renderer 测试，重点验证普通 composer status line、slash suggestion status line 和 resize recovery。
