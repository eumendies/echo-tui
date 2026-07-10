## Why

当前 fenced code block 只使用统一代码样式显示，语言信息已被解析但没有参与渲染，导致 assistant 输出配置、脚本和代码片段时可读性有限。先增加一个简单、通用、跨行的语法高亮能力，可以在不改变 transcript 事实模型的前提下提升 TUI 中代码块阅读体验。

## What Changes

- 为 fenced code block 增加 render-only 的语法高亮投影，所有语言第一版共用一套通用高亮规则。
- 高亮器以整个 code block 为输入，支持跨行状态，至少能在多行字符串或块注释等未在单行内闭合的场景中保持稳定样式。
- 保持现有代码块视觉约束：不绘制边框、卡片或语言标签，不解析代码块内部 inline Markdown，不改变 transcript 原始 Markdown。
- 未知语言、空语言和无法识别的语法都使用同一套通用规则安全降级，不因高亮失败中断渲染。
- 为语法 token 引入可配置的终端颜色主题；第一版配置作用于通用 token kind，而不是为每种语言维护独立主题。
- 不引入第三方语法高亮库，不实现 IDE 级完整语言解析，也不支持代码执行、复制或折叠等交互能力。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `markdown-terminal-rendering`: fenced code block 的“直接高亮”要求从单一代码颜色扩展为通用、跨行、可配置的语法 token 高亮，同时保持 Markdown render-only 和安全降级语义。

## Impact

- 影响 `src/render/markdown.ts` 中 fenced code block 渲染路径，并可能新增独立的 render 层语法高亮模块。
- 影响 `src/terminal/ansi.ts` 或相关渲染样式边界，以支持从配置派生 token 样式。
- 影响用户级 `~/.echo/config.json` 的非 LLM 配置读取：需要读取可选的 TUI 语法高亮颜色配置，但配置错误不应阻断核心聊天能力。
- 需要补充 Markdown/code block 渲染测试、跨行高亮测试、配置覆盖测试、unknown language 降级测试和 streaming 未闭合 fence 稳定性测试。
- 需要同步 `docs/README.md`、`docs/tui-architecture.md` 和 `markdown-terminal-rendering` spec。
