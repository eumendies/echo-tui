## Why

当前 thinking 与 working 状态使用通用单字符旋转 spinner，虽然能表达活跃状态，但视觉上与 Echo 的 cyan 声波主题不够一致。已有 echo 主题 spinner 原型验证了“中心向外扩散的声场波纹”更贴合产品气质，适合沉淀为 TUI 的统一响应动画。

## What Changes

- 将 thinking/working 的状态动画迁移到 status line 中原 ready/PLAN 所在的状态段。
- 状态段使用固定宽度 echo wave field 动画，保持 thinking 与 working 的运动语言一致。
- 非响应中状态继续按既有 ready/PLAN 逻辑显示。
- 保留现有 `elapsedMs` 驱动的纯渲染投影模型，不引入后台线程、独立动画对象或第三方 TUI 依赖。
- 移除 thinking pending preview 和 working footer 独立行中的 spinner 显示，避免重复占用 footer 高度。
- 更新测试，覆盖 status line 中的新 spinner 帧、稳定显示宽度、非响应中 ready/PLAN 保留和独立行移除。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: thinking/working 响应状态在 status line 状态段中显示 echo 主题声场波纹动画。

## Impact

- 影响 status line 状态段的响应中投影。
- 影响 thinking pending preview 和 working 独立 footer 行的可见行为。
- 可能新增共享的 spinner 渲染 helper，以复用帧表、时间步进和 cyan 亮度着色。
- 影响 `test/render/blocks.test.js` 与 `test/render/footer.test.js` 中对 spinner 文本和宽度稳定性的断言。
- 不改变 agent lifecycle、turn context timer、footer redraw 调度、transcript 持久化或命令交互语义。
