## Context

当前 `echo_tui` 的输入链路已经分成清晰的三层：`src/input/key-parser.js` 把原始按键转换为语义事件，`src/app/main.js` 负责提交分流、历史状态和 fake agent 生命周期，`src/render/footer.js` / `src/render/layout.js` 负责把 composer 与 hint 投影到底部临时区域。最近已经加入了多行编辑、历史浏览和 `Ctrl+A/E/U/K/W`，但输入区仍只有“普通 composer”这一种工作模式。

这次最小版 slash 命令并不是要做完整命令系统，而是要验证另一种输入区模式：用户提交纯 `/help` 后，不把它当作普通 user message，也不把帮助内容写进 transcript，而是在 composer/footer 区域显示一个临时的帮助面板，并通过 Esc 退出。

当前已有两个关键约束：

- `key-parser` 继续保持无跨 chunk 缓冲的实现；本 change 不顺手重做输入缓冲模型。
- 现有 transcript 是 append-only，普通交互路径只允许 footer-only redraw；因此 `/help` overlay 应复用 footer 临时区，而不是引入新的 transcript role 或 full replay 路径。

## Goals / Non-Goals

**Goals:**
- 仅支持纯 `/help` 一个 slash 命令，用于显示当前按键说明。
- 让 `/help` 在 app 层提交前分流，不触发 agent thinking / streaming，不追加 transcript，不进入输入历史。
- 让帮助内容覆盖在 composer/footer 区域，并支持 Esc 退出后回到普通输入态。
- 保持现有 render 架构、append-only transcript 模型和最小依赖不变。

**Non-Goals:**
- 不支持 slash 参数、子命令、模糊匹配、自动补全或命令列表选择。
- 不支持 `/help anything` 这类带额外文本的命令语法；此类输入按普通 user message 提交。
- 不新增 transcript 的 `system` role，不把帮助内容写入历史区域。
- 不借这个 change 处理通用 modal 系统或重新设计 footer 全局布局。

## Decisions

### Decision: slash 判定发生在提交阶段，但由独立模块承担解析与执行
`/help` 的特殊语义只在用户按 Enter 提交时成立；在编辑阶段，`/`、`h`、`e`、`l`、`p` 都仍然只是普通文本。因此 slash 判定仍应发生在提交阶段，而不是 `key-parser` 或 `composer`。但为了避免后续命令扩展时把分支不断堆进 `src/app/main.js`，命令解析和执行应拆到独立模块，例如：

- `src/commands/parse-slash-command.js`：把已提交文本解析为 `null` 或命令描述，例如 `{ name: 'help' }`；
- `src/commands/run-slash-command.js`：根据命令描述返回 app 需要的结果，例如“打开 help overlay”；
- `src/app/main.js`：只负责在提交路径中调用它们，并根据返回结果切换 overlay、历史和 agent 状态。

这样做有三个好处：

- 不需要为 `/` 增加新的按键语义；
- 带后缀文本时可直接落回普通 user message 提交；
- 命令是否进入历史、是否启动 agent，都可以在同一个 app 层分流点决定，同时保留未来扩展多个命令时的清晰边界。

备选方案一：直接在 `src/app/main.js` 中用 if/else 特判 `/help`。放弃原因是最小版虽然能跑，但会让后续命令扩展继续堆积在 orchestration 层。

备选方案二：在输入阶段进入“slash mode”。放弃原因是超出最小版范围，会把问题扩展到命令补全、候选渲染和键盘导航。

### Decision: 只识别内容精确等于 `/help` 的纯命令
本次不支持参数，因此命令命中规则保持最硬边界：只有提交内容精确等于 `/help` 时，才进入 help overlay。只要 `/help` 后面还带任何其他字符（包括空格后文本），就按普通 user message 提交。

备选方案：对提交文本做 trim 后再识别，或允许 `/help anything` 继续命中帮助。放弃原因是会引入参数语义和歧义，不符合“最小版只支持纯 slash 命令”的目标。

### Decision: help overlay 作为 app 层的显式临时状态，而不是 transcript 记录
帮助内容要“覆盖显示在 composer 区域”，本质上属于 footer 临时区的一种变体，而不是事实消息记录。因此 app 层需要持有一个显式 overlay 状态，例如 `overlay: null | { kind: 'help' }`，由 footer 渲染路径根据该状态决定当前输入 surface 是普通 composer，还是 help overlay。

这意味着：

- 进入 `/help` 时不追加 user transcript record；
- 不启动 fake agent，也不显示 thinking / streaming；
- 退出 overlay 后恢复普通 composer surface；
- resize 时 overlay 仍可被 destructive recovery 重新投影，因为它是 app 当前状态的一部分。

备选方案：把帮助文本伪装成 assistant transcript。放弃原因是会污染 append-only transcript，也不符合“Esc 关闭临时面板”的交互模型。

### Decision: overlay 退出使用 bare Esc 语义事件，且只在 overlay 活跃时消费
最小版需要支持 Esc 关闭 overlay，因此输入层要把 bare `\x1b` 暴露成语义事件，例如 `ESCAPE`。app 层只在 overlay 活跃时消费这个事件并退出 overlay；普通输入态下按 Esc 可以继续视为无动作。

由于 parser 仍然无跨 chunk 缓冲，方向键 escape sequence 若极端地被拆成多次 chunk，首个 `\x1b` 可能被当作 bare Esc。这与当前 parser 的限制一脉相承，本次接受该风险，不额外引入缓冲机制。

备选方案：仅在 `UNKNOWN` 中识别 `\x1b`。放弃原因是语义边界更弱，测试和 app 分支也更绕。

### Decision: overlay 活跃时 footer 切换为“帮助内容 + 退出提示”，并隐藏光标
普通 footer 目前固定渲染 composer 和 hint。为了让 `/help` 更像临时面板，overlay 活跃时 footer 应切换为帮助内容和显式的退出提示（如 `Esc 关闭`），而不是继续显示可编辑 composer。为避免出现误导性的编辑光标，overlay 模式下 footer renderer 应允许隐藏光标，而普通输入态仍恢复到 composer 逻辑位置。

备选方案：仍显示 composer 光标，并把帮助文本作为若干“伪 composer 行”渲染。放弃原因是视觉语义不清楚，看起来像仍可编辑。

### Decision: `/help` 不进入输入历史，退出 overlay 后 composer 为空
`/help` 是本地命令触发，不是一次普通 user message 提交，因此不应写入 session input history。进入 overlay 后，原本输入的 `/help` 也不需要保留；退出 overlay 时直接回到空 composer，可以保持用户对“临时命令”的直觉。

备选方案：把 `/help` 也纳入历史，或在退出后恢复 `/help` 原文。放弃原因是会让历史浏览掺入大量命令噪音，也不符合短生命周期 overlay 的预期。

## Risks / Trade-offs

- [Risk] bare Esc 与无缓冲 parser 组合后，在少数终端中可能误吃被拆 chunk 的方向键前缀 → Mitigation：保持“长序列优先匹配”并接受现有限制，把该行为约束明确写进 design，不在本次扩大到跨 chunk 缓冲。
- [Risk] overlay 引入“footer 不是永远等于 composer + hint”的第二种模式，会让 footer renderer 的状态分支增加 → Mitigation：把 overlay 建模为明确的 surface 变体，而不是在 renderer 中散落布尔开关。
- [Risk] overlay 活跃时隐藏光标会改动 footer renderer 当前固定 show-cursor 的假设 → Mitigation：把光标可见性作为 layout/render 契约的一部分，仅在 overlay 分支启用。
- [Risk] 若未来再加 `/clear`、`/model` 等命令，slash 模块接口若定义过窄，仍可能把复杂度重新挤回 `main.js` → Mitigation：第一版就把“解析”和“执行结果”抽成独立模块边界，让 app 只消费结构化结果。

## Migration Plan

1. 在输入事件与 key parser 中补充 bare Esc 的语义事件，并保持现有长 escape sequence 优先匹配顺序。
2. 新增最小 slash 解析/执行模块，并在 app 层提交路径中调用它们；纯 `/help` 切换到 overlay，而不是启动 agent。
3. 扩展 footer/layout 渲染，使 composer 区域可以在普通输入态和 help overlay 态之间切换，并支持 overlay 模式隐藏光标。
4. 更新测试，覆盖 `/help` 命中、带后缀文本降级为普通消息、Esc 退出 overlay、历史隔离和 footer 渲染分支。

## Open Questions

- 第一版是否需要在 help overlay 中保留当前 hint 行，还是完全由 overlay 内部的退出提示替代？当前建议是替代，以保持界面更像独立临时面板。
