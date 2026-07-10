## Why

当前 thinking 态的 pending preview 只是把 spinner 字符和 `thinking...` 拼成一段纯文本，再交给 footer 走普通文本渲染。它已经满足基本可用性，但视觉上还比较平：spinner 会转，文案本身没有层次，也无法安全承载更细的 shimmer 动效。

现在希望把 thinking pending preview 升级为更接近产品化的状态表现：保留现有转圈 spinner，同时让 `thinking` 文案出现平滑的 shimmer 扫光效果，并继续保证 footer-only redraw、布局稳定和 streaming 开始后的无缝切换。

## What Changes

- 将 thinking pending preview 从“单个纯文本字符串”升级为结构化 display state，而不是把带 ANSI 的富文本直接塞进 `pending.text`。
- 在 render 层为 thinking 态增加 shimmer 文案投影，形成“spinner glyph + shimmer label + dots”的视觉组合。
- 保持 streaming draft 继续使用普通文本 pending preview，不把 thinking 动效模型泄漏到 streaming 内容渲染。
- 补充测试，覆盖 thinking shimmer 的宽度稳定性、流转到 streaming 的切换，以及窄宽度下的安全降级。

## Capabilities

### New Capabilities
- 无

### Modified Capabilities
- `terminal-tui-prototype`: 调整 assistant thinking pending preview 的显示模型，使其支持结构化 thinking state 和 shimmer 动效，同时保持 footer 布局稳定与 streaming 切换语义不变。

## Impact

- 受影响代码：`src/app/main.js`、`src/render/app-renderer.js`、`src/render/footer.js`、`src/render/blocks.js` 以及相关测试。
- 受影响行为：assistant thinking 期间的 pending preview 视觉表现和内部状态形态会变化，但 transcript append、footer-only redraw、resize destructive replay 和 streaming 完成语义保持不变。
- 不引入新的运行时依赖；继续基于 ANSI 控制序列和现有 render/layout 工具实现。
