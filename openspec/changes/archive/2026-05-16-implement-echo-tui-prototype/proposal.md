## Why

项目需要一个最小、无第三方 TUI 依赖的 Node.js 终端 TUI 原型，用来验证交互式输入、append-only transcript 输出，以及 assistant 流式响应在当前终端中的协作方式。这个原型会先建立可运行基础，再为后续接入真实 agent 或模型留出清晰边界。

## What Changes

- 创建名为 `echo_tui` 的 CommonJS Node.js 项目，并提供 `npm start` 作为运行入口。
- 使用 ANSI 控制序列和 stdin raw mode 实现终端 TUI，不依赖第三方 TUI 库。
- 用户和 assistant 已提交消息以 transcript block 形式只追加，不回写历史内容。
- 增加可重绘 footer 区域，包含可选 pending preview、多行 composer 和固定 1 行 hint。
- 支持字符级 composer 编辑，包括中文字符、退格、向前 Delete、左右移动、Home/End、Enter 提交、Ctrl+J 插入换行和退出快捷键。
- 增加 mock assistant adapter：先显示 2 秒 thinking 状态，再逐字输出用户原始输入，完成后把 assistant 消息块正式追加到 transcript。
- 增加架构和使用文档，包含模块、流程、子流程和终端区域示意图。
- 增加验证步骤，覆盖 `npm start` 和所有 JavaScript 文件的 `node --check`。

## Capabilities

### New Capabilities
- `terminal-tui-prototype`: 定义无第三方 TUI 依赖的终端 TUI 原型行为，包括 transcript 追加、footer 渲染、composer 输入处理、mock assistant 流式响应、启动/退出和验证要求。

### Modified Capabilities

无。

## Impact

- 新增 `bin/`、`src/` 和 `docs/` 下的项目文件。
- 新增 `package.json`，声明 Node.js >= 20 和 CommonJS 设置。
- 不引入运行时第三方依赖，也不引入第三方 TUI 框架。
- 影响范围仅限新的终端原型及其文档。
