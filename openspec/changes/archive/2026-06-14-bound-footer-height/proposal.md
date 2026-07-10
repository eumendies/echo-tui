## Why

当前 footer 局部重绘依赖“上一帧 footer 仍完全位于可见屏幕内”这一前提；当长 bash 审批、长 tool pending、长 composer 或长 command surface 把 footer 撑到超过终端可见高度时，旧 footer 的顶部会进入 scrollback，后续 `clear` 无法清理残留内容。

这个问题会破坏当前终端模式下的 UI 一致性，尤其在高危 bash 授权时最容易复现，因此需要把 footer 高度约束提升为渲染层不变量。

## What Changes

- 为 footer layout 建立全局高度上限：在已知 terminal rows 时，footer 总行数 SHALL 不超过 `rows - 2`，为屏幕顶部保留两行安全空间。
- 普通 composer 在超过可用高度后 SHALL 以光标附近可见窗口渲染，顶部旧行可被挤出，不额外显示省略提示。
- command surfaces、slash suggestions、choice options、choice message 和 pending previews SHALL 在高度预算内裁剪或窗口化。
- `tool_call` pending preview SHALL 像 streaming preview 一样接受最大行数预算，避免长 bash 调用在审批出现前就撑爆 footer。
- 高危 bash 审批 SHALL 在长 command preview 或多行风险说明下保持 footer 可清理，同时继续显示标题、至少一个风险原因和可操作选项。
- 不引入 alternate screen、第三方 TUI 库或持久化状态变化。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `terminal-tui-prototype`: footer 局部重绘新增全局高度约束，composer、pending preview、slash suggestion 和 command surface 都必须遵守可见屏幕预算。
- `interactive-choice-surface`: choice surface 在高度受限时需要裁剪 message、窗口化 options，并保持当前选中项与内联输入光标可见。
- `tool-approval`: 高危 bash 审批详情在长 preview 下必须保持 bounded footer 行为，同时保留安全决策所需的标题、风险原因和选项。

## Impact

- 主要影响 `src/render/footer.ts`、`src/render/footer/*`、`src/render/blocks.ts` 和 `src/render/tool-message-renderer.ts` 的布局预算与裁剪逻辑。
- 需要更新 footer、choice surface、approval 和 pending preview 相关测试，覆盖长 bash 审批、长 tool call pending、超高 composer、slash suggestions/options 窗口化和极小 terminal rows。
- 不改变 transcript 事实内容、tool approval 决策协议、provider 输入、持久化格式或终端 raw mode 生命周期。
