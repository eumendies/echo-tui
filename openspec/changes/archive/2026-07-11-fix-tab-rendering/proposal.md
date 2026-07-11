## Why

粘贴包含制表符的异常堆栈或代码时，渲染器把制表符按单列计算，而终端会将其移动到下一个制表位。这会使实际光标位置与布局计算脱节，造成 composer 边框、用户消息前缀和背景断裂。

## What Changes

- 统一终端文本渲染中制表符的可见表示与显示宽度计算。
- 保持 composer 和 transcript 中原始提交文本不变，仅规范化渲染输出。
- 为 composer 和用户消息增加包含制表符的回归测试，保证边框、前缀和背景行不发生隐式换行。

## Capabilities

### New Capabilities

- `tab-safe-terminal-rendering`: 保证含制表符文本在终端 TUI 中按稳定的可见列宽渲染。

### Modified Capabilities

- `terminal-tui-prototype`: composer 与用户消息的终端投影需要支持稳定显示含制表符的内容。

## Impact

- 影响 `src/render/layout.ts` 的宽度、换行和 composer 投影逻辑。
- 影响 `src/render/blocks.ts` 的用户消息换行和填充逻辑。
- 增加 `test/render/layout.test.js`、`test/render/footer.test.js` 与 `test/render/blocks.test.js` 的回归覆盖；不改变 provider 请求或持久化的原始文本。
