## Context

当前 TUI 的可交互临时区域集中在 footer：`renderFooterLayout` 会在 pending/working 行之后绘制 divider，再绘制 composer 或 command surface。`ToolApprovalContext` 目前把 `apply_patch` 授权请求投影为 `SelectCommandSurface`，因此它和 `/model`、`/resume` 等普通命令选择使用同一套低强调 UI。

这个设计虽然复用了现有输入和 footer 重绘链路，但对工具授权这种“模型主动发起、阻塞执行、需要用户明确决策”的场景不够显眼。后续 `AskUserQuestion` 也会需要类似的用户选择界面，因此新 surface 应避免命名为 approval/tool 专属概念。

## Goals / Non-Goals

**Goals:**

- 引入通用 `choice` surface，服务于 tool approval 和后续用户问题选择场景。
- 让 tool approval 出现时比普通 select command surface 更显眼，但不通过长文案堆叠制造噪音。
- 让选项 label 成为视觉主角；description 仅作为辅助信息，在下一行灰色显示。
- 保持 tool approval 的 `Allow once` / `Deny` 简洁选项，不添加冗余 description。
- 继续使用 footer 临时区域、ANSI 控制序列和 stdin raw mode。

**Non-Goals:**

- 不实现真正屏幕中央 modal、遮罩层或绝对定位 overlay。
- 不引入第三方 TUI 框架。
- 不改变工具授权决策模型、agent loop runtime 的拦截点或 `apply_patch` 执行语义。
- 不在本变更中实现 `AskUserQuestion` 工具；只为它保留可复用 surface 形态。

## Decisions

### 使用通用 `choice` surface，而不是 `approval` surface

新增 surface kind 应表达“需要用户做选择”的交互语义，而不是绑定到 tool approval。建议命名为 `choice`，类型可沿用现有 surface union 所在模块，第一步减少跨层重命名成本。

替代方案：命名为 `approval`。该方案能准确描述当前 `apply_patch` 场景，但后续 `AskUserQuestion` 复用会语义不自然。

替代方案：命名为 `prompt`。该方案更泛化，但容易和文本 prompt、system prompt 混淆；`choice` 更直接表达 UI 行为。

### 保持 footer 内卡片化渲染，不做居中 overlay

choice surface 仍由 footer renderer 管理，使用边框、留白和高亮选中项提高可见性。这样可以复用当前 footer-only redraw、destructive recovery 和 resize 机制。

替代方案：实现屏幕中央 modal。该方案视觉更强，但需要维护 footer 之外的可擦除区域、恢复背后 transcript、处理滚动和 resize，和当前不使用 alternate screen 的架构冲突更大。

### 选项 label 独占一行，description 下一行灰色显示

普通 select surface 当前使用 `label — description` 单行展示，这适合紧凑命令列表，但会削弱高优先级选择中的选项识别度。choice surface 应让 label 独占一行，并在 description 存在时用灰色弱化文本显示在下一行，必要时在选项之间插入空行。

tool approval 的 `Allow once` 和 `Deny` 不需要 description；保持空描述可让选项区域更干净。

### 保持输入事件处理不变

`ToolApprovalContext.handleEvent` 继续消费激活期间的所有输入，Up/Down 移动、Enter 选择、Esc 拒绝的行为不变。变化集中在 surface 类型和渲染层，不改变授权 promise 的 resolve 时机。

## Risks / Trade-offs

- [Risk] choice surface 增加 footer 高度，可能压缩 streaming pending preview → 继续使用现有 pending preview 高度预算；choice surface 的文案保持短小，避免过高。
- [Risk] 新 surface 仍在底部，不如真正居中 modal 抢眼 → 用边框、留白、标题和选中项反色提升识别度；后续如需要可单独设计 overlay renderer。
- [Risk] `CommandSurface` 名称与非 command 场景不完全匹配 → 本次仅新增 `choice` kind，避免大规模重命名；后续可再把上层概念迁移为 `InteractiveSurface` 或 `InputSurface`。
- [Risk] description 换行规则和普通 select 不一致 → 这是刻意区分：普通 select 保持紧凑，choice surface 专注高优先级选择。
