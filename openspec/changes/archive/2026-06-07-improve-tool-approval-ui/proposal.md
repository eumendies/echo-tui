## Why

当前 `apply_patch` 授权拦截复用了普通 command select footer，视觉层级和 `/model`、`/resume` 等主动命令选择相同，不足以提示用户当前正在处理一个会阻塞工具执行的高优先级选择。

同时后续 `AskUserQuestion` 等交互也需要复用类似的选择 surface，因此需要抽象一个通用、显眼但信息密度低的 choice surface，而不是把新 UI 绑定到 tool approval 或 command 语义上。

## What Changes

- 新增通用 choice surface，用于 tool approval 和后续 AskUserQuestion 一类需要用户显式选择的交互。
- tool approval 不再投影为普通 `select` surface，而是投影为通用 choice surface。
- choice surface 使用边框、留白和选中项高亮提高可见性，但保持文案克制，优先突出选项本身。
- choice option 的 `description` 不再和 label 拼在同一行；存在描述时 SHALL 在 label 下一行以灰色弱化样式显示。
- `apply_patch` 授权选项继续只显示 `Allow once` 和 `Deny`，不为这两个简单选项补充冗长描述。
- 不引入第三方 TUI 库，不切换 alternate screen，不实现真正屏幕中央 overlay。

## Capabilities

### New Capabilities
- `interactive-choice-surface`: 定义通用 choice surface 的可见布局、选项描述呈现方式、输入提示和复用边界。

### Modified Capabilities
- `tool-approval`: 将 `apply_patch` 授权请求的可见 UI 从普通 select command surface 改为通用 choice surface，并保持授权决策语义不变。

## Impact

- 影响 `src/types/command.ts` 或后续等价 surface 类型定义，新增通用 choice surface 类型。
- 影响 `src/app/tool-approval-context.ts`，将 tool approval 投影为 choice surface。
- 影响 `src/render/footer.ts`，新增 choice surface 渲染，并调整 description 的换行灰色显示规则。
- 影响 `test/render/footer.test.js` 和 `test/app/main.test.js` 中有关 tool approval surface kind、布局和选项显示的断言。
- 不改变 agent loop runtime、tool executor、`apply_patch` handler、授权决策模型或拒绝结果语义。
