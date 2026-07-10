## 1. Footer 预算模型

- [x] 1.1 在 `renderFooterLayout` 中引入 footer 全局最大高度计算，已知 rows 时使用 `rows - 2` 并处理 rows 缺失或极小值。
- [x] 1.2 调整 pending、working、divider、input surface 的预算分配顺序，优先保证交互区可见，再把剩余高度给 pending preview。
- [x] 1.3 添加最终 layout 兜底裁剪，保证返回的 `lines.length` 和 `cursorRow` 始终合法。

## 2. Composer 与普通 footer 内容

- [x] 2.1 为 boxed composer 增加基于光标行的高度 viewport，裁剪后重新计算 cursor row/column。
- [x] 2.2 确保 composer 被裁剪时不显示 `...` 或 `…` 隐藏提示，持续输入时顶部旧行自然被挤出。
- [x] 2.3 为 slash suggestions 增加围绕 selectedIndex 的可见窗口，候选过多时不渲染全量列表。

## 3. Command 与 choice surfaces

- [x] 3.1 扩展 command surface 渲染入口，使 info、select、checkbox、confirm、resume、skills、scale 和 choice 能接收高度预算或被统一裁剪。
- [x] 3.2 为 select/checkbox 类列表增加 selectedIndex 周围窗口化，保持当前选中项可见。
- [x] 3.3 为 choice surface 增加 message 裁剪和 options 窗口化，保持标题、当前选项、内联输入光标和操作提示可见。
- [x] 3.4 确保 choice surface 裁剪后边框宽度、safe render width 和 cursor 坐标仍正确。

## 4. Pending 与工具预览

- [x] 4.1 让 `tool_call` pending preview 接受最大行数预算，并对长 bash command 或长 arguments 做预算内渲染。
- [x] 4.2 保持 streaming pending 现有摘要/尾部预览行为，同时接入新的全局 footer 预算。
- [x] 4.3 验证高危 bash approval 同时存在长 tool pending 和长 approval message 时，总 footer 高度仍不超过 `rows - 2`。

## 5. 测试与验证

- [x] 5.1 更新 `test/render/footer.test.js`，覆盖长 bash approval、长 tool call pending、超高 composer、slash suggestions 窗口化和极小 rows。
- [x] 5.2 更新 choice surface 相关测试，覆盖长 message 裁剪、options 窗口化、inline input 光标可见和边框对齐。
- [x] 5.3 如 app/controller 层需要新的 render state 传递，补充对应 app 测试，确保 resize 与 footer redraw 仍调用正确。
- [x] 5.4 运行 `npm run typecheck`。
- [x] 5.5 运行 `npm test`。
- [x] 5.6 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
