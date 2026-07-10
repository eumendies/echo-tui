## 1. 消息视觉布局

- [x] 1.1 设计统一的消息布局 helper，支持前缀符号、首行同线文本和后续行缩进
- [x] 1.2 将 user transcript 从 `user:` 标签改为与 composer 一致的 `>` 前缀和灰色强调样式
- [x] 1.3 将 assistant transcript 从 `assistant:` 标签改为 `◆` 前缀和 assistant 专属样式
- [x] 1.4 确保多行 user 和 assistant 消息的后续行按文本列对齐

## 2. pending preview 和 spinner

- [x] 2.1 将 pending assistant preview 改为与 assistant transcript 相同的布局规则，并使用 `◇` 前缀
- [x] 2.2 在 app 层实现 thinking spinner 状态和定时刷新，不把 timer 逻辑放入 footer renderer
- [x] 2.3 在 assistant thinking 阶段显示周期变化的 spinner frame
- [x] 2.4 在 streaming 开始、assistant 完成和应用退出时清理 spinner timer
- [x] 2.5 确保 assistant streaming 完成后，从 pending preview 到最终 transcript 不发生文本起始列跳变

## 3. ANSI 样式和宽度计算

- [x] 3.1 按需在 `src/terminal/ansi.js` 增加背景色或弱强调 helper
- [x] 3.2 确保 layout 计算使用未上色文本，ANSI 样式只在最终输出阶段应用
- [x] 3.3 验证符号前缀、灰色背景或颜色强调不会破坏 wrap 和 composer 光标定位

## 4. banner 和 hint 视觉层级

- [x] 4.1 将 banner 调整为更克制的 session header，减少重边框装饰
- [x] 4.2 保持 banner 显示 `echo_tui`、cwd、Node 版本、TTY 尺寸和运行模式
- [x] 4.3 将 hint 调整为固定 1 行弱强调状态栏，并保持快捷键信息完整

## 5. 文档和验证

- [x] 5.1 更新 `docs/README.md`，说明新的 transcript 符号、pending spinner 和视觉行为
- [x] 5.2 更新 `docs/tui-architecture.md`，说明消息布局、pending preview 和 spinner 的职责边界
- [x] 5.3 运行 `node --check` 覆盖 `bin/` 和 `src/` 下所有 JavaScript 文件
- [x] 5.4 运行 `npm start` 手动验证 banner、hint、user/assistant 符号、pending spinner、streaming 到完成的布局稳定性、多行对齐和退出 cleanup
