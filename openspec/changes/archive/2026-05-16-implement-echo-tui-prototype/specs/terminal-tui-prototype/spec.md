## ADDED Requirements

### Requirement: Node CommonJS 项目
系统 SHALL 提供一个名为 `echo_tui` 的可运行 Node.js 项目，使用 Node.js >= 20、CommonJS 模块，并且没有运行时第三方 TUI 库依赖。

#### Scenario: start 命令运行入口文件
- **WHEN** 开发者运行 `npm start`
- **THEN** 项目 SHALL 执行 `bin/echo-tui.js`

#### Scenario: 使用 CommonJS 模块
- **WHEN** JavaScript 源文件被加载
- **THEN** 源文件 SHALL 使用 CommonJS `require` 和 `module.exports` 作为模块边界

#### Scenario: 不需要第三方 TUI 依赖
- **WHEN** 项目被安装并运行
- **THEN** 终端 UI 行为 SHALL 使用 Node.js 内建能力、ANSI 控制序列和 stdin raw mode 实现，而不是依赖 TUI framework

### Requirement: 当前终端执行
系统 SHALL 在当前终端中运行，不切换到 alternate screen，也不清空已有终端内容。

#### Scenario: 应用启动在已有输出之后
- **WHEN** 应用启动
- **THEN** 应用 SHALL 在已有 terminal scrollback 之后追加 banner 和 UI，而不是清空屏幕

#### Scenario: 不使用 alternate screen
- **WHEN** 应用运行
- **THEN** 应用 SHALL NOT 输出进入或离开 alternate screen 的 ANSI 序列

### Requirement: 启动 banner
系统 SHALL 在 TUI 启动时显示启动 banner。

#### Scenario: 启动时显示 banner
- **WHEN** 应用进入交互模式
- **THEN** 应用 SHALL 在 footer 绘制前，把可见的 `echo_tui` banner 追加到 transcript 区域

### Requirement: append-only transcript
系统 SHALL 把已提交的用户消息和已完成的 assistant 消息作为 append-only transcript block 处理。

#### Scenario: 用户提交追加 transcript block
- **WHEN** 用户使用 Enter 提交 composer 内容
- **THEN** 应用 SHALL 向 transcript 追加一个用户消息块，并且不重写更早的 transcript block

#### Scenario: assistant 完成后追加 transcript block
- **WHEN** mock assistant 完成响应流式输出
- **THEN** 应用 SHALL 追加一个 assistant 消息块，内容为完成后的 assistant 输出

#### Scenario: 历史 transcript 不被重绘
- **WHEN** footer 在输入或 streaming 期间重绘
- **THEN** 已提交的 transcript block SHALL 在 terminal scrollback 中保持不变

### Requirement: footer 布局
系统 SHALL 渲染底部 footer，footer 由可选 pending preview、1 到 N 行 composer 和固定 1 行 hint 组成。

#### Scenario: footer 显示 composer 和 hint
- **WHEN** 没有 pending assistant response
- **THEN** footer SHALL 渲染 composer，并在其后渲染恰好 1 行 hint

#### Scenario: assistant 工作期间显示 pending preview
- **WHEN** assistant 正在 thinking 或 streaming
- **THEN** footer SHALL 在 composer 和 hint 上方包含 pending preview

#### Scenario: composer 支持多行显示
- **WHEN** composer 内容包含插入的换行，或因终端宽度发生 wrap
- **THEN** footer SHALL 为 composer 分配足够的行数，再渲染 hint 行

### Requirement: footer 重绘和光标恢复
系统 SHALL 在重绘 footer 时隐藏光标，重绘结束后把光标恢复到 composer 逻辑位置并重新显示。

#### Scenario: 光标仅在重绘期间隐藏
- **WHEN** footer renderer 执行重绘
- **THEN** 它 SHALL 在清理和绘制 footer 行之前输出 hide cursor，并在定位完成后输出 show cursor

#### Scenario: 光标回到 composer 编辑位置
- **WHEN** composer 内容或光标状态发生变化
- **THEN** 可见终端光标 SHALL 在 footer 重绘后位于 composer 的逻辑光标位置

#### Scenario: 等待输入时光标保持可见
- **WHEN** 应用正在等待用户输入
- **THEN** 光标 SHALL 在当前 composer 位置保持可见

### Requirement: composer 字符级编辑
系统 SHALL 支持 printable input 的字符级 composer 编辑，包括中文字符，并且不使用 `string.length` 作为光标模型。

#### Scenario: printable 字符插入到光标位置
- **WHEN** 用户输入 printable 字符
- **THEN** 字符 SHALL 被插入到当前 composer 光标位置

#### Scenario: 中文字符作为一个编辑单元
- **WHEN** 用户输入中文字符，或在中文字符之间移动光标
- **THEN** composer SHALL 把该中文字符视为一个光标移动和编辑单元

#### Scenario: Backspace 删除前一个字符
- **WHEN** 用户按下 Backspace，且光标前至少有一个字符
- **THEN** composer SHALL 删除光标前的那个字符

#### Scenario: Delete 删除后一个字符
- **WHEN** 用户按下 Delete，且光标后至少有一个字符
- **THEN** composer SHALL 删除光标后的那个字符

#### Scenario: 左右方向键在边界内移动
- **WHEN** 用户按下 Left 或 Right
- **THEN** composer 光标 SHALL 向左或向右移动一个字符，并且不会移出内容边界

#### Scenario: Home 和 End 移动到当前逻辑行边界
- **WHEN** 用户按下 Home 或 End
- **THEN** composer 光标 SHALL 移动到当前逻辑行的开头或结尾

#### Scenario: Ctrl+J 插入换行
- **WHEN** 用户按下 Ctrl+J
- **THEN** composer SHALL 在光标位置插入换行，而不是提交消息

### Requirement: 提交和响应锁
系统 SHALL 使用 Enter 提交 composer 内容，并在 assistant response 活跃期间禁止第二次提交。

#### Scenario: Enter 提交非空内容
- **WHEN** 用户在 composer 内容非空且没有 active assistant response 时按下 Enter
- **THEN** 应用 SHALL 追加用户消息块、清空 composer，并启动 mock assistant response

#### Scenario: 空内容 Enter 不提交
- **WHEN** 用户在 composer 内容为空时按下 Enter
- **THEN** 应用 SHALL 保持 transcript 不变，并继续停留在输入模式

#### Scenario: response 进行中阻止提交
- **WHEN** assistant 正在 thinking 或 streaming
- **THEN** 按下 Enter SHALL NOT 启动另一个 assistant response

### Requirement: 退出快捷键
系统 SHALL 在用户按下 Ctrl+C 或 Ctrl+D 时干净退出。

#### Scenario: Ctrl+C 退出
- **WHEN** 用户按下 Ctrl+C
- **THEN** 应用 SHALL 恢复 terminal input mode、显示光标并退出

#### Scenario: Ctrl+D 退出
- **WHEN** 用户按下 Ctrl+D
- **THEN** 应用 SHALL 恢复 terminal input mode、显示光标并退出

### Requirement: mock assistant 生命周期
系统 SHALL 实现 fake assistant adapter：显示 2 秒 thinking 状态，逐字 streaming 用户原始提交内容，并在 streaming 完成后提交最终 assistant block。

#### Scenario: thinking 状态先于 streaming
- **WHEN** 用户消息被提交
- **THEN** footer pending preview SHALL 在 token streaming 开始前显示约 2 秒 assistant thinking 状态

#### Scenario: streaming 回显原始输入
- **WHEN** fake assistant 进行 streaming
- **THEN** 它 SHALL 按顺序逐字输出用户原始提交内容

#### Scenario: 完成后提交 assistant transcript
- **WHEN** 所有字符都已 streaming 完成
- **THEN** pending preview SHALL 被清空，并且完成后的 assistant 消息 SHALL 被追加到 transcript

### Requirement: 模块边界
系统 SHALL 把 terminal、input、render、agent 和 application orchestration 代码放在不同模块中，并使用直接清晰的命名。

#### Scenario: 存在建议目录结构
- **WHEN** 实现完成
- **THEN** 项目 SHALL 包含 `bin/echo-tui.js`、`src/app/main.js`、`src/terminal/ansi.js`、`src/terminal/tty.js`、`src/input/event-types.js`、`src/input/key-parser.js`、`src/input/composer.js`、`src/render/layout.js`、`src/render/footer.js`、`src/render/blocks.js`、`src/agent/fake-agent.js`、`package.json`、`docs/README.md` 和 `docs/tui-architecture.md`

#### Scenario: app 层编排模块
- **WHEN** 应用运行
- **THEN** `src/app/main.js` SHALL 协调 terminal setup、input parsing、composer state、rendering、transcript append 和 fake agent callback

### Requirement: 架构文档
系统 SHALL 提供使用说明和 TUI 架构文档。

#### Scenario: README 说明运行和验证
- **WHEN** 开发者打开 `docs/README.md`
- **THEN** 文档 SHALL 说明原型目标、前置要求、`npm start`、控制方式和验证步骤

#### Scenario: 架构文档包含示意图
- **WHEN** 开发者打开 `docs/tui-architecture.md`
- **THEN** 文档 SHALL 包含模块架构图、运行流程图、assistant 响应子流程图，以及 footer、composer、hint、transcript 的区域示意图

#### Scenario: 架构文档说明重要函数
- **WHEN** 开发者阅读 `docs/tui-architecture.md`
- **THEN** 文档 SHALL 描述 terminal、input、render、agent 和 app 模块的重要函数

### Requirement: JavaScript 语法验证
系统 SHALL 支持使用 `node --check` 验证所有 JavaScript 文件语法。

#### Scenario: 所有 JavaScript 文件通过语法检查
- **WHEN** 开发者对 `bin/` 和 `src/` 下每个 JavaScript 文件运行 `node --check`
- **THEN** 每个文件 SHALL 在没有语法错误的情况下通过检查
