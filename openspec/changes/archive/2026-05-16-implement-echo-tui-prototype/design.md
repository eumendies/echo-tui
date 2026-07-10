## Context

当前仓库只有 OpenSpec 元数据。这个变更会为 `echo_tui` 创建第一个可运行项目：一个基于 Node.js >= 20、CommonJS 的终端 TUI 原型，并且直接运行在用户当前终端中。

原型必须避免第三方 TUI 库，不能切换到 terminal alternate screen，也不能清空用户已有 scrollback。因此实现需要精确控制 ANSI 光标移动、raw stdin 事件、append-only transcript 输出，以及当前 viewport 底部的一小块可重绘 footer 区域。

## Goals / Non-Goals

**Goals:**
- 提供只依赖 Node.js 内建能力的可运行 `npm start` 原型。
- 按职责拆分代码：`terminal`、`input`、`render`、`agent` 和 `app`。
- 通过只追加已提交 user/assistant block 来保留 transcript 历史。
- 只重绘 footer 区域，用于 pending assistant preview、composer 和 hint。
- 每次重绘后保持 composer 光标可见，并把光标放回逻辑编辑位置。
- 输入处理以 Unicode code point / 近似字符单元为基础，而不是 byte length 或 `string.length`。
- 用 fake adapter 演示 assistant 生命周期：thinking delay、streaming echo、最终 transcript append。
- 文档化模块架构、运行流程、assistant 子流程、终端区域和重要函数。

**Non-Goals:**
- 接入真实 LLM 或模型。
- 持久化 transcript。
- Markdown 渲染、语法高亮、鼠标支持、选择支持，或超出原型范围的完美 resize 行为。
- 完整 Unicode grapheme cluster 支持；原型优先覆盖中文字符和常见 Unicode code point，不增加依赖。

## Decisions

### 使用 Node 内建能力和 ANSI 字符串

terminal 层会暴露小而直接的 ANSI escape sequence helper 和 TTY setup helper，而不是引入 TUI framework。

- 理由：用户明确要求不依赖第三方 TUI 库，并且希望原型展示 raw terminal 机制。
- 备选方案：使用 `blessed`、`ink` 或其他 TUI 包。拒绝原因是违反依赖约束，并且会把 footer/cursor 行为隐藏在框架抽象后面。

### transcript append-only，footer 可变

已提交用户消息和已完成 assistant 消息会作为 transcript block，通过普通 stdout append 写出。footer 会被视为 transcript 下方的临时可重绘区域。

- 理由：append-only transcript 避免改写历史输出，也让 terminal scrollback 更容易理解。
- 备选方案：每次输入都重绘整个屏幕。拒绝原因是这需要清空或重写已有终端内容，与当前终端运行约束冲突。

### 通过已知 footer 高度清理重绘区域

footer renderer 会记录上一次渲染的 footer 高度。绘制新 footer 前，先隐藏光标，按已知 footer 区域移动并清理这些行，再绘制新 footer，最后把光标放回 composer 逻辑位置并显示光标。

- 理由：跟踪 footer 高度能把重绘范围限制在 footer 内，避免清理用户已有终端内容。
- 备选方案：从光标清理到屏幕末尾，或切换 alternate screen。拒绝原因是两者影响范围都过大，可能干扰无关终端内容。

### composer 内容用字符数组表示

composer state 会把可编辑内容存为由 `Array.from(input)` 生成的字符数组。光标位置使用数组 index，而不是 UTF-16 index。

- 理由：`Array.from` 会把中文字符作为单个单元处理，对于这个无依赖原型已经足够。
- 备选方案：直接使用 `string.length` 和 `slice`。拒绝原因是 UTF-16 code unit 索引会破坏中文和其他非 ASCII 输入体验。
- 备选方案：使用完整 `Intl.Segmenter` grapheme segmentation。当前原型不要求，但后续如果要完善 emoji 和 combining mark，可以在 composer 边界升级。

### 只解析必要按键序列

key parser 会识别 printable characters、Backspace、Delete、Left、Right、Home、End、Enter、Ctrl+J、Ctrl+C 和 Ctrl+D。未知 escape sequence 会被忽略。

- 理由：保持原型聚焦，便于验证。
- 备选方案：实现完整 terminal key parser。拒绝原因是超出第一版原型范围。

### fake agent 使用异步 callback

fake agent 会暴露一个函数，接收已提交文本和 thinking、token streaming、completion 生命周期 callback。app 层负责 response-lock 状态和 transcript commit。

- 理由：mock 行为独立后，后续替换成真实 adapter 会更直接。
- 备选方案：把 timer 逻辑硬编码在 app loop 中。拒绝原因是会让 UI 状态和 agent 行为耦合过紧。

## Risks / Trade-offs

- 终端宽度不稳定 -> 使用 `process.stdout.columns`，并提供 fallback width，wrap 逻辑保持简单。
- footer 高度记录出错 -> 把 footer render/clear 逻辑集中在 `src/render/footer.js`，避免其他模块直接写 footer。
- Unicode 显示宽度不完全准确 -> 光标定位时把中文字符按宽度 2 处理，把 ASCII/常见字符按宽度 1 处理，并在文档中说明这是原型级行为。
- raw mode 清理遗漏 -> 为 Ctrl+C、Ctrl+D、正常退出和 process signal 注册 cleanup，恢复 stdin mode 和光标显示。
- resize 行为可能不完美 -> resize 时重绘 footer，但保持 transcript append-only，不尝试修复历史布局。
