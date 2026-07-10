## Why

当前 footer 底部的 hint 是静态字符串，只能展示固定快捷键，无法表达当前项目、运行状态或不同输入上下文。将 hint 升级为 status line 可以在不增加额外 UI 区域的前提下，持续展示当前上下文和动态交互提示。

## What Changes

- 使用 footer status line 替换普通 composer 下方的静态 hint 行。
- status line SHALL 展示当前项目名、当前选择的模型、运行模式和当前上下文适用的非显而易见操作提示。
- 普通 composer、slash suggestion、thinking、streaming、tool call pending 等状态 SHALL 显示不同 mode/key hint。
- command surface、choice surface、confirm surface 和 info surface SHALL 继续使用各自的 `dismissHint`，不被全局 status line 覆盖。
- status line SHALL 遵循现有 footer 局部重绘、resize recovery、安全宽度和 ANSI 渲染约束。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `terminal-tui-prototype`: 修改 footer/composer 区域的提示展示契约，从静态 hint 升级为动态 status line。

## Impact

- 影响 `src/types/render.ts` 的 render state 类型，新增或替换 status line 状态。
- 影响 `src/app/main.ts`、`src/app/app-context.ts`、`src/app/render-context.ts` 中 render state 的组装，并复用 `ModelContext` 当前模型信息。
- 影响 `src/render/footer.ts` 的普通 composer surface 渲染逻辑。
- 影响 footer/app renderer 相关测试中对 hint 行和布局高度的断言。
- 不新增运行时依赖，不引入第三方 TUI framework，不使用 alternate screen。
