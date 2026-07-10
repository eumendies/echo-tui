## 1. 项目初始化

- [x] 1.1 创建 `package.json`，包含项目名 `echo_tui`、Node.js >= 20 engine、CommonJS type 和 `npm start` script
- [x] 1.2 创建 `bin/echo-tui.js`，作为加载 `src/app/main.js` 的可执行入口
- [x] 1.3 创建所需的 `src/` 和 `docs/` 目录结构

## 2. 终端层

- [x] 2.1 实现 `src/terminal/ansi.js`，提供光标移动、光标显示/隐藏、行清理和文本样式等聚焦的 ANSI helper
- [x] 2.2 实现 `src/terminal/tty.js`，负责进入 raw mode、恢复终端状态、注册 cleanup handler，并暴露终端尺寸
- [x] 2.3 确保终端层不输出 alternate screen 序列或全屏清空序列

## 3. 输入层

- [x] 3.1 在 `src/input/event-types.js` 中定义 input event 常量
- [x] 3.2 实现 `src/input/key-parser.js`，解析 printable 字符、Backspace、Delete、Left、Right、Home、End、Enter、Ctrl+J、Ctrl+C 和 Ctrl+D
- [x] 3.3 实现 `src/input/composer.js`，包含字符数组 state、cursor index 移动、插入、删除、换行插入、提交值提取和 reset
- [x] 3.4 验证 composer 逻辑把中文字符作为单个编辑单元，并避免用 `string.length` 管理光标状态

## 4. 渲染层

- [x] 4.1 实现 `src/render/layout.js`，处理基于终端宽度的 line wrapping、display width 计算和 composer 光标坐标计算
- [x] 4.2 实现 `src/render/blocks.js`，渲染启动 banner、用户 transcript block 和 assistant transcript block
- [x] 4.3 实现 `src/render/footer.js`，跟踪上一次 footer 高度，在重绘期间隐藏光标，只清理 footer 行，渲染 pending preview/composer/hint，并恢复光标
- [x] 4.4 确保 footer 重绘保留 append-only transcript 输出，并在等待输入时保持光标可见

## 5. agent 和 app 编排

- [x] 5.1 实现 `src/agent/fake-agent.js`，包含 2 秒 thinking delay、逐字 streaming 用户原始提交输入，以及 completion callback
- [x] 5.2 实现 `src/app/main.js`，初始化终端状态、打印 banner、绘制 footer、解析 stdin event、修改 composer state，并路由 render update
- [x] 5.3 在 Enter 成功提交时追加用户 transcript block，并清空 composer
- [x] 5.4 在 fake assistant thinking 或 streaming 期间阻止额外提交
- [x] 5.5 streaming 完成后清空 pending preview，并追加最终 assistant transcript block
- [x] 5.6 在 Ctrl+C 和 Ctrl+D 时干净退出，恢复 raw mode 和光标显示

## 6. 文档

- [x] 6.1 编写 `docs/README.md`，说明项目目的、前置要求、运行命令、控制方式、行为说明和验证步骤
- [x] 6.2 编写 `docs/tui-architecture.md`，包含模块架构图、运行流程图、assistant 响应子流程图、终端区域示意图和重要函数说明
- [x] 6.3 确保文档说明应用运行在当前终端、不使用 alternate screen，并保持 transcript block append-only

## 7. 验证

- [x] 7.1 对 `bin/` 和 `src/` 下每个 JavaScript 文件运行 `node --check`
- [x] 7.2 运行 `npm start`，手动验证 banner、footer、字符输入、Backspace、Delete、Left/Right、Home/End、Ctrl+J 插入换行、Enter 提交、response lock、mock thinking、streaming echo、最终 transcript append，以及 Ctrl+C/Ctrl+D cleanup
- [x] 7.3 总结验证命令和手动验证结果
