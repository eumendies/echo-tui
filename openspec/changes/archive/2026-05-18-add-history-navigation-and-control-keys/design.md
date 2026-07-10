## Context

当前输入链路分为三层：`src/input/key-parser.js` 负责把 escape sequence 解析为语义事件，`src/app/main.js` 负责根据输入事件更新 app 状态并触发 footer 重绘，`src/input/composer.js` 负责字符级编辑。现有能力已经覆盖 printable input、左右移动、Home/End、Backspace/Delete 和 `Ctrl+J` 换行，但还没有 session 内历史输入浏览，也没有 readline 风格的 `Ctrl+A/E/U/K/W` 快捷编辑。

这次变更有两个明确约束：

- 不处理 key parser 的跨 chunk escape sequence 缓冲；继续沿用当前无缓冲 parser。
- 不引入 draftBeforeHistory 恢复模型；只有在 composer 为空且 assistant 不处于 thinking / streaming 时，Up/Down 才允许进入历史浏览。

另外，用户还要求当 composer 中已有内容时，Up/Down 不应进入历史，而应作为多行 composer 的垂直光标移动键。这意味着输入层不能只靠“composer 是否为空”判断全部语义，还必须识别“当前是否已经进入历史浏览模式”。

## Goals / Non-Goals

**Goals:**
- 为输入系统补充 Up/Down 历史浏览和 `Ctrl+A/E/U/K/W` 五组控制按键。
- 让 Up/Down 具备明确优先级：空 composer + idle response 进入历史浏览；否则用于多行 composer 的垂直移动。
- 把历史输入限定为当前进程内的 session 状态，只记录成功提交的 user 输入。
- 保持现有 render 架构和 footer-only redraw 模型不变，仅扩展输入语义和 app 状态。

**Non-Goals:**
- 不解决 key parser 跨 chunk escape sequence 缓冲问题。
- 不做历史持久化、历史搜索、自动补全或 draftBeforeHistory 恢复。
- 不把输入模型升级为完整 readline / editor，也不引入新的运行时依赖。

## Decisions

### Decision: Up/Down 采用“双语义 + 显式历史浏览模式”
Up/Down 不是单一行为，而是按当前输入上下文分流：

- composer 为空，且 assistant 不在 thinking / streaming：进入或继续历史浏览；
- 其余情况：执行多行 composer 的垂直光标移动。

为了避免“首次 Up 载入历史后 composer 变为非空，导致下一次 Up/Down 又被误判成垂直移动”，app 层需要持有显式的历史浏览状态，例如 `historyIndex: number|null`。只要 `historyIndex !== null`，后续 Up/Down 就继续浏览历史，而不是退回普通垂直移动。

备选方案：只靠 `composer` 是否为空决定是否浏览历史。放弃原因是进入历史后的 composer 一定非空，后续导航语义会立即自相矛盾。

### Decision: 历史记录保存在 app 层，并且只在成功提交时追加
历史输入属于会话级状态，应与 `composer`、`pending`、`transcriptRecords` 一样由 `src/app/main.js` 持有，而不是塞到 `composer` 模块。建议状态最小形态为：

- `inputHistory: string[]`
- `historyIndex: number|null`

其中：

- 用户成功按 Enter 提交非空输入时，把该文本追加到 `inputHistory`；
- assistant thinking / streaming 期间不允许从空 composer 进入历史浏览；
- 历史浏览向下回到“最新一项之后”时，composer 清空，并把 `historyIndex` 置回 `null`。

备选方案：历史记录与浏览索引直接挂在 composer 内部。放弃原因是历史属于 session 级 app 语义，不是字符数组编辑器本身的职责。

### Decision: 不做 draftBeforeHistory，但要保留“从空输入进入历史”的硬边界
既然用户明确不需要 draft 恢复模型，本次设计将历史入口限制为“composer 为空时”才能进入。这样向上查看历史之前没有待恢复草稿，向下退出历史时直接清空 composer 即可。

这条约束也意味着：

- 用户正在输入任何内容时，Up/Down 一律不进入历史；
- 历史浏览只在“空输入 → 查看旧命令 → 返回空输入”这一闭环内生效。

备选方案：保留 `draftBeforeHistory`，支持半成品输入进出历史。放弃原因是超出这次范围，且会显著增加状态分支和测试负担。

### Decision: composer 扩展为“字符编辑 + 行列辅助 + 删除快捷键”
`Ctrl+A/E/U/K/W` 与 Up/Down 垂直移动都需要比现有 `moveLeft/Right/Home/End` 更丰富的 helper。实现上仍保持 `composer.chars + cursor` 模型，但补充以下能力：

- 按当前逻辑行计算行首/行尾，用于 `Ctrl+A`、`Ctrl+E`、`Ctrl+U`、`Ctrl+K`；
- 计算当前逻辑列并在相邻逻辑行中寻找目标光标位置，用于 Up/Down 垂直移动；
- 基于简单词边界规则删除前一个词，用于 `Ctrl+W`。

词边界规则建议采用轻量实现：连续空白视作分隔符，先跳过光标前空白，再删除前一个连续非空白片段。

备选方案：把 composer 重构成行数组或带列缓存的复杂结构。放弃原因是当前文本规模很小，额外结构会放大实现成本。

### Decision: 输入事件使用语义名称，而不是原始键名
输入层应尽量向 app 暴露业务语义，而不是底层物理键名。建议新增事件形态如下：

- `MOVE_UP`
- `MOVE_DOWN`
- `MOVE_LINE_START`
- `MOVE_LINE_END`
- `DELETE_TO_LINE_START`
- `DELETE_TO_LINE_END`
- `DELETE_PREVIOUS_WORD`

其中 `MOVE_LINE_START` / `MOVE_LINE_END` 可同时由 Home/End 与 `Ctrl+A/E` 触发，避免 app 层区分“物理键不同但语义相同”的分支。

备选方案：直接引入 `CTRL_A`、`CTRL_E` 等事件。放弃原因是会把 app 层重新绑回具体按键，不利于复用已有 Home/End 语义。

## Risks / Trade-offs

- [Risk] 无缓冲 parser 在少数终端中仍可能把 Up/Down escape sequence 拆坏 → Mitigation：在 design 中明确这是已接受限制，并在 proposal/spec 中保持非目标，不在本次实现中偷偷扩大范围。
- [Risk] Up/Down 同时承担历史浏览和垂直移动，理解成本高于单一语义 → Mitigation：把入口规则写进 hint 和 spec，并通过显式 `historyIndex` 模式避免实现分叉失控。
- [Risk] `Ctrl+W` 的词边界实现可能与 bash/zsh/readline 细节不完全一致 → Mitigation：采用简单、一致、可测试的空白分隔规则，不追求完全复刻所有 shell 行为。
- [Risk] 垂直移动需要在不同行长度之间做列对齐，若算法不清晰容易出现跳跃感 → Mitigation：定义“优先保持逻辑列，超过行尾则夹到该行末尾”的固定规则，并以多行测试锁定行为。

## Migration Plan

1. 在 `key-parser` 与 `event-types` 中加入 Up/Down 和 `Ctrl+A/E/U/K/W` 对应事件映射。
2. 在 `composer` 中补充垂直移动、删除到行首/行尾、删除前一个词等 helper。
3. 在 `app` 中增加 session 级历史状态，并接入 Up/Down 的双语义分流逻辑。
4. 更新 hint 与测试，覆盖 parser、composer、app orchestration 和历史浏览边界。

## Open Questions

- 是否需要在第一版中为历史浏览增加去重或最大长度限制？当前建议是不做，先保持最简单的 append-only session history。
