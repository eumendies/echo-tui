## Context

`ask_user_questions` 是 agent loop 中的交互式工具：provider 发起 tool call 后，runtime 解析参数并把请求交给 app 的 `UserQuestionContext`，由它逐题投影为通用 `ChoiceCommandSurface`，footer renderer 再渲染为 choice card。当前协议、状态机和结果格式都以单选为中心：`selectedIndex` 同时表达当前高亮行和最终答案，成功结果也只返回单个 `selected` label。

本变更需要跨越 tool schema、app 状态、surface 类型和 footer 渲染，但不需要新依赖，也不改变 agent loop 的交互式 tool callback 架构。

## Goals / Non-Goals

**Goals:**

- 让 `ask_user_questions` 的单道问题可以声明为多选题，并保持未声明时的单选兼容行为。
- 在用户问题 choice card 中支持 Space 切换多选项、Enter 确认多选答案、Esc 取消请求。
- 将 choice surface 的“键盘焦点”和“选中/勾选状态”拆开，避免 `selectedIndex` 在多选语义下混淆。
- 保留 `Other` 内联输入能力；多选题中非空自定义文本应作为一个已选答案返回。
- 保持现有单选成功结果格式不变，降低对 provider 和模型上下文的兼容风险。

**Non-Goals:**

- 不为所有 command surface 统一重命名 `selectedIndex`；本次只调整 `ChoiceCommandSurface` 及其调用链。
- 不复用现有普通 `checkbox` command surface 作为用户问题 UI。
- 不支持每个问题的最少/最多选择数量配置；多选题仅要求至少一个答案。
- 不改变 tool approval 的授权决策语义，只随 choice surface 字段重命名做适配。

## Decisions

### Decision: question 使用 `multiSelect?: boolean` 声明多选

默认单选最符合现有行为，也避免模型必须为每道题显式声明模式。`multiSelect: true` 只在问题允许多个选项同时成立时使用。

备选方案是新增独立 `ask_user_multi_select_questions` 工具，但这会复制问题数组、选项、取消和 `Other` 自定义答案逻辑，也会增加 provider 可用工具数量。当前工具本来就是用户澄清问题入口，用字段扩展更集中。

### Decision: choice surface 使用 `focusedIndex` 表达键盘焦点

多选后当前高亮行不再等同于最终选择，因此 `selectedIndex` 容易误导。`ChoiceCommandSurface` 改用 `focusedIndex` 表达键盘焦点；多选勾选状态由 option 级 `checked` 表达。renderer 使用 `focusedIndex` 决定焦点条、active background 和窗口化位置，使用 `checked` 决定多选 marker。

备选方案是保留 `selectedIndex` 并新增 `checked`，但会让 `selectedIndex` 在单选和多选中含义不同，后续维护时容易把焦点误当答案。

### Decision: 多选结果新增 `selectedOptions`，单选结果保持 `selected`

单选答案继续返回 `{ index, selected }`，多选答案返回 `{ index, multiSelect: true, selectedOptions }`。这样避免 `selected` 同时承载 string 和 array 两种类型，也让模型能明确区分两类答案。

备选方案是统一改成 `selectedOptions`，但这会破坏现有单选 result 约定；或让 `selected` 在多选时变为数组，但字段类型不稳定，不利于模型和测试判断。

### Decision: 多选 `Other` 由非空文本自动纳入答案

`Other` 是内联输入区域，Space 在该区域更自然地表示输入空格，而不是 toggle。多选题中只要 `Other` 文本 trim 后非空，就视为选择了 `Other`，并在 result 中携带 `customText`。

备选方案是为 `Other` 维护独立 checked 状态，但会出现“勾选 Other 但文本为空”或“文本非空但未勾选”的歧义，也会和 composer 编辑语义冲突。

### Decision: 不切换到现有 `checkbox` surface

现有 `checkbox` command surface 是普通列表，不具备 choice card 的 question message、description 下一行、内联输入光标映射和高度约束逻辑。扩展 choice card 可以保持 approval 与用户问题的视觉一致性，并复用刚建立的内联输入背景行为。

## Risks / Trade-offs

- [Risk] `ChoiceCommandSurface.selectedIndex` 改名会影响 tool approval 和测试。→ Mitigation：将改名范围限制在 choice surface 链路，其他 select/checkbox/skills/mcp/scale surface 保持不变，并补充编译期与渲染测试。
- [Risk] 多选题没有最大选择数量，模型可能提出语义上需要限制数量的问题。→ Mitigation：当前仅覆盖“可多选”的基础语义，复杂数量约束留给未来字段扩展。
- [Risk] `Other` 非空自动选中可能让用户误以为还需要 Space 切换。→ Mitigation：多选提示明确写出“Space 选择/取消 · 输入 Other · Enter 确认”。
- [Risk] result 同时存在单选和多选两种答案形状。→ Mitigation：保留单选兼容格式，多选显式携带 `multiSelect: true` 和 `selectedOptions`，并在 spec 与测试中固定。

## Migration Plan

实现时先扩展类型和 parser，再更新 `UserQuestionContext` 状态机，最后调整 choice renderer 与测试。由于 `multiSelect` 默认 false，旧 tool call 与旧单选结果不需要迁移。若需要回滚，移除 schema 字段和多选状态路径即可，单选路径应保持独立可用。

## Open Questions

无当前阻塞问题。未来如果需要更强约束，可以考虑为 question 增加 `minSelections` / `maxSelections`，但本变更不包含该能力。
