## Context

当前 `ChoiceCommandSurface` 已经被 tool approval 和 `ask_user_questions` 复用，输入事件在 `src/app/main.ts` 中优先分发给活跃的用户问题或工具授权上下文。普通 composer 的文本编辑能力集中在 `src/input/composer.ts`，而 choice surface 目前只处理上下移动、Enter 和 Esc。

这次改动需要在同一个 choice box 内完成选择和自由文本输入，不能拆成“先选择 Other，再弹出单独输入框”的两阶段流程。系统风险原因仍只用于 UI 展示，不作为用户反馈回传给模型。

## Goals / Non-Goals

**Goals:**

- 在 choice surface 中支持特定 option 携带内联文本输入状态、placeholder 和 cursor。
- tool approval 提供 `Tell model what to do` 选项，用户提交文本后返回 `provide_feedback` 决策。
- `ask_user_questions` 提供 `Other` 选项，用户提交文本后在 answer JSON 中返回 `customText`。
- 文本编辑复用现有 composer 操作，保持 Backspace、Delete、左右移动、Home/End 等编辑行为一致。
- 只回传用户输入的文本，不回传系统风险分类原因。

**Non-Goals:**

- 不支持多行内联文本输入；Enter 仍用于提交当前选项。
- 不引入第三方 TUI 框架或 alternate screen。
- 不改变 `ask_user_questions` 的多选能力；本次仍保持逐题单选。
- 不增加会话级工具授权选项。

## Decisions

1. **在 `ChoiceCommandSurface` option 上建模内联输入，而不是新增独立 surface。**
   - 原因：用户期望“就一个框”，并且当前 tool approval / user question 已经共用 choice surface。
   - 替代方案：新增 text prompt surface 或二阶段流程；该方案交互割裂，已被明确排除。

2. **上下文持有 per-request 的 `ComposerState`，renderer 只消费快照。**
   - 原因：输入语义属于 `tool-approval-context` 和 `user-question-context`，渲染层不应修改状态。
   - 替代方案：让 renderer 管理输入 buffer；这会破坏现有单向 render state 流程。

3. **只有选中内联输入 option 时，文本编辑事件才进入该 option 的 composer。**
   - 原因：保持普通选项的键盘行为简单明确，避免用户在 `Allow once` 或预设答案上误输入。
   - 替代方案：任意 option 都可输入；该方案会混淆选择和文本反馈语义。

4. **提交内联文本 option 时要求非空文本。**
   - 原因：空 `provide_feedback` 或空 `customText` 对模型没有可执行信息，也容易误触。
   - 替代方案：允许空文本并按 deny/cancel 处理；这会让 Enter 语义不直观。

5. **宽度和光标位置由 choice renderer 基于显示宽度计算。**
   - 原因：placeholder、用户文本、选项编号和边框都在同一行渲染，cursor 必须落在 footer 的实际行列上。
   - 替代方案：不显示真实终端光标；这无法满足选中输入项时出现光标的体验要求。

## Risks / Trade-offs

- [Risk] ANSI 高亮、灰色 placeholder 和显示宽度混用时 cursor column 可能偏移 → Mitigation：只对整段 option 行使用简单样式，cursor column 基于 plain text 前缀和输入 cursor 计算，并为 renderer 增加覆盖测试。
- [Risk] 中英文宽字符文本可能影响 clamp 和 cursor → Mitigation：沿用现有 `displayWidth`/clamp 工具，测试至少覆盖 ASCII placeholder 和普通文本路径。
- [Risk] `ask_user_questions` 自动追加 `Other` 可能与模型传入的同名选项重复 → Mitigation：仍追加系统级自定义输入项，但 answer 中通过 `customText` 明确区分自由文本答案。
- [Risk] 用户选中内联输入项但未输入内容时不知道为何 Enter 不提交 → Mitigation：placeholder 和 dismiss hint 明确提示输入文本后 Enter 提交。
