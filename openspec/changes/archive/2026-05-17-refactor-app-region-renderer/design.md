## Context

上一轮 `fix-footer-redraw-residue` 已经把渲染模型稳定为三条路径：

- 普通输入编辑 / spinner / pending 更新：只重绘 footer；
- transcript 新增事实内容：先清 footer，再 append transcript block，最后恢复 footer；
- resize：执行 destructive full replay，从当前 records 和 footer state 重建完整快照。

但这些路径目前仍然分散在 `src/app/main.js`：app 层既直接调用 `footer.render()` / `footer.clear()`，又直接调用 `renderUserBlock()` / `renderAssistantBlock()` 和 `output.write()`，同时还在 resize 时单独调用 `app-region`。读代码时很容易误以为 `app-region` 与 `footer` 是两个并列视觉区块，而不是“一个统一 renderer 门面 + 一个 footer 子模块”的关系。

当前的 `src/render/app-region.js` 名字也已经和真实职责不完全一致：它不再代表“除 footer 之外的上半屏区域”，而是 resize/final render 时的完整快照重放器；一旦把 normal redraw 和 append path 的编排也收口进来，这个模块更接近一个 `app renderer` 门面。

## Goals / Non-Goals

**Goals:**
- 让 app 层只表达“发生了什么渲染事件”，不再直接拼接多个 renderer 和底层 `output.write()`。
- 把 footer-only redraw、append transcript、destructive replay 三类渲染路径统一收口到单一渲染门面。
- 为原 `app-region` 模块换成与实际职责更一致的名字，并同步更新文档、测试和注入接口。
- 保持当前 TUI 行为完全不变，重点只在代码边界与术语收敛。

**Non-Goals:**
- 不改变 banner、footer、transcript block 的视觉样式和交互语义。
- 不引入新的渲染抽象层级、事件总线或第三方库。
- 不顺手修复与本次边界重构无关的 backlog，例如 key parser 跨 chunk 缓冲、emoji/grapheme 编辑模型等。

## Decisions

### Decision: 用单一 app renderer 门面对外暴露渲染入口
`main.js` 只依赖一个统一 renderer，而不再同时依赖 `footer`、`blocks` 和 `output.write()`。这个 renderer 对外至少需要覆盖三类显式入口：

- 普通 footer 更新；
- transcript append；
- destructive full replay。

app 层继续决定“当前发生的是哪类事件”，但具体该清 footer、写 block、同步 footer 形状还是重放完整快照，都由统一 renderer 编排。

选择这个方案而不是继续在 `main.js` 中保留多路 renderer 调用的原因：上一轮虽然修正了行为，但渲染策略仍散在编排层，导致变量名和模块名很难直接传达结构。

备选方案：只增加注释，不调整模块边界。放弃原因是它改善阅读体验有限，后续每新增一种渲染路径仍会把 `main.js` 往“半个 renderer”方向推。

### Decision: 将 `app-region` 重命名为更贴近职责的 `app-renderer`
重构后统一门面会同时承担 footer-only redraw、append transcript 和 destructive replay 的编排，因此继续使用 `app-region` 容易让人误解为“一个区域对象”而不是“应用级 renderer”。

本次设计选择将 `src/render/app-region.js` 重命名为 `src/render/app-renderer.js`，导出工厂也调整为 `createAppRenderer`。内部仍可保留 `buildRegion` 这类“完整快照构建”辅助函数，但它们成为 `app-renderer` 的实现细节。

备选方案：保留文件名 `app-region.js`，只改导出函数名。放弃原因是文件路径本身仍会持续输出误导性的术语。另一个备选名字是 `snapshot-renderer`，放弃原因是它过度强调 destructive replay，无法体现 footer-only redraw 和 append path 的门面职责。

### Decision: footer 与 blocks 保持为子模块，但只由 app renderer 直接组合
`footer.js` 仍负责 footer 的局部擦除、布局和光标恢复；`blocks.js` 仍负责 banner、user block、assistant block 和 pending lines 的底层投影。不同的是，这两个模块不再由 `main.js` 直接使用，而是改由 `app-renderer` 统一组合。

这样可以保留现有小模块的低层职责，同时把“何时选择哪条渲染路径”从 app 层移出。测试也可以更自然地围绕 `app-renderer` stub，而不是同时 mock 多个 render 依赖。

备选方案：把 footer 和 blocks 代码全部并进 `app-renderer`。放弃原因是会把当前清晰的布局/块渲染辅助函数打散，得不偿失。

### Decision: 通过行为不变的重构测试保护现有渲染模型
现有 `test/app/main.test.js` 已经能区分 normal redraw、append path 和 resize replay。重构时重点不是新增行为断言，而是把测试依赖从分散的 `footer` / `appRegion` stub 收拢到统一 renderer stub，同时保留对三类路径的行为断言。

备选方案：只做文件重命名，不更新测试门面。放弃原因是测试接口会继续暴露旧边界，不能真正保护这次重构目标。

## Risks / Trade-offs

- [Risk] 一次同时做“职责收口 + 文件重命名”，diff 体积会偏大 → Mitigation：先保持行为和数据流不变，只收边界和命名，不顺手改其他渲染逻辑。
- [Risk] `app-renderer` 名称过于宽泛，未来可能继续膨胀 → Mitigation：明确它只负责渲染编排门面，布局计算和块渲染继续留在 `footer` / `blocks` 子模块。
- [Risk] 文档、README、测试和依赖注入接口都要同步调整，容易漏改 → Mitigation：任务里显式列出代码、测试、文档三类收口点，并在最终验证里检查命名替换是否完整。

## Migration Plan

1. 引入新的 `app-renderer` 门面接口，并把 `main.js` 的 normal redraw / append / resize 路由切过去。
2. 将原 `app-region.js` 的完整快照构建和 destructive replay 能力迁移到新文件名下；保留 `footer.js` / `blocks.js` 作为内部依赖。
3. 更新测试 stub、架构文档和 README 中的文件路径与术语。
4. 运行现有自动化测试和语法检查，确认这是一次行为不变的重构。

如果重构后发现门面接口反而变得更绕，可以回退到上一版边界；因为本次不改外部行为，所以回滚风险主要在代码组织而非数据迁移。

## Open Questions

- `app-renderer` 对外 API 最终是保留三个显式方法（如 `renderFooter` / `appendRecord` / `renderDestructive`），还是再进一步收敛为一个带 `type` 的单入口 `render()`？这影响接口风格，但不影响本次 proposal 的总体方向。
