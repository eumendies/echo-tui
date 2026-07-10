## Why

当前 TUI 的渲染职责已经在行为上分成三条路径：普通交互只重绘 footer、transcript append 只追加消息块、resize 才做 destructive full replay。但在代码边界上，`src/app/main.js` 仍同时直接操作 `app-region`、`footer`、`blocks` 和 `output.write`，导致阅读时难以一眼看清“谁负责决定渲染路径，谁负责真正输出”。

现在需要把这些渲染逻辑统一收口到原 `app-region` 模块，并根据它的真实职责改成更贴切的命名，让 `main.js` 更像应用状态机，而不是半个 renderer。这样后续继续扩展渲染路径时，语义和维护成本都会更稳定。

## What Changes

- 将当前分散在 `src/app/main.js` 中的渲染路由逻辑收口到单一渲染门面，由它统一编排 footer-only redraw、transcript append 和 destructive replay 三类路径。
- 根据统一后的职责，为原 `app-region` 模块选择更贴切的名字，并同步更新调用方、测试和相关文档表述。
- 约束 `main.js` 不再直接组合 `footer renderer`、`blocks renderer` 和底层 `output.write`，而是通过统一 renderer 接口表达“发生了什么渲染事件”。
- 补充或调整自动化测试，确保重构后 normal redraw / append / resize replay 的行为保持不变。

## Capabilities

### New Capabilities
- 无

### Modified Capabilities
- `terminal-tui-prototype`: 收紧渲染模块边界，要求 app 层通过单一渲染门面编排 footer-only redraw、transcript append 和 destructive replay，并使用与该职责一致的模块命名。

## Impact

- 受影响代码：`src/app/main.js`、`src/render/app-region.js`（及其重命名后的文件）、`src/render/footer.js`、`src/render/blocks.js`、相关测试与架构文档。
- 受影响接口：app 层与 render 层之间的注入接口和测试 stub 需要调整为统一 renderer 形态。
- 不引入新的运行时依赖，不改变既有 TUI 交互行为与终端语义；重点是重构代码边界与命名。
