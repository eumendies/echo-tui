## 1. 升级 pending thinking state 的表示

- [x] 1.1 调整 `src/app/main.js` 中 thinking / streaming 阶段的 pending 数据形态，使 thinking 不再只是 `pending.text`，而是最小结构化 display state。
- [x] 1.2 保持 spinner timer 仍由 app 层驱动，但只向 render 层传递 thinking frame / streaming draft 这类状态，而不是预拼好的富文本字符串。

## 2. 在 render 层实现 shimmer thinking preview

- [x] 2.1 更新 `src/render/blocks.js`、`src/render/footer.js` 或 `src/render/app-renderer.js` 中的 pending 投影逻辑，为 thinking 态生成“spinner glyph + shimmer label + dots”效果，同时保持 streaming 继续走普通文本 preview。
- [x] 2.2 确保 shimmer 的宽度、换行和缩进基于未上色文本计算，窄宽度下允许安全降级，但不能输出破碎的 ANSI 序列或破坏布局。

## 3. 补充验证与效果确认

- [x] 3.1 更新或新增自动化测试，覆盖结构化 thinking state、thinking → streaming 切换、布局稳定性和窄宽度下的安全降级。
- [x] 3.2 运行 `npm test`、`find bin src test -name '*.js' -exec node --check {} \;`，并手动确认 thinking shimmer 在真实终端中视觉提升明显且不会影响 footer-only redraw。
