## Context

当前工具授权请求和 `ask_user_questions` 都投影为通用 `choice` surface。高危 bash 审批曾把 command preview 和风险原因拼成 `message` 文本，再由 choice renderer 按普通 message 处理。这个模型有两个问题：一是长 command 下 `Preview` 与 `Reasons` 的层级不明显；二是风险原因来自固定规则，面对复杂 shell command 容易不准确，展示出来反而可能影响用户判断。

授权 UI 已经具备高度受限布局：footer layout 会传入 `maxLines`，choice renderer 在空间不足时优先保留选项和提示。新设计需要复用这条约束，不能为了视觉卡片而让长 preview 进入 scrollback 或挤掉拒绝路径。

## Goals / Non-Goals

**Goals:**

- 将通用 choice UI 调整为 card 风格：工具授权显示 permission gate，用户问题显示 question/answer card。
- 高危 bash 审批只展示 command preview，不展示系统推断 reason。
- 保留现有授权决策模型、选项顺序、会话级授权缓存和反馈输入能力。
- 保留 footer 高度限制；长 command preview 必须被裁剪或窗口化，选项和拒绝路径优先保留。
- 删除旧 yellow choice 视觉路径，tool approval 和用户问题流程统一使用同一套 choice card。

**Non-Goals:**

- 不改变哪些 tool call 需要审批的风险分类策略。
- 不引入第三方 TUI 库、alternate screen 或新的终端生命周期。
- 不把风险原因回传给模型，也不把用户授权选择写入 transcript 或持久化配置。
- 不重新设计 apply_patch diff 展示或 tool transcript 渲染。

## Decisions

### 1. choice surface 使用通用 card 字段，而不是 permission 专用字段

`ToolApprovalContext` 和 `UserQuestionContext` 应向 renderer 提供同一组 UI 字段，例如 `message`、`messageTitle`、`messageStyle`、`optionsTitle`。renderer 只理解 card 结构，不理解 permission/question 上层语义。

替代方案是保留 `variant: 'permission'` 和 `preview`。该方案能工作，但会把上层业务语义混入通用 UI 层，并要求 question 迁移时继续扩展 variant。

### 2. 复用 choice 的交互模型，定制 permission 的视觉投影

permission gate 和用户问题仍然都是 choice surface：上下移动、Enter 确认、Esc 取消/拒绝、inline input cursor 都沿用现有行为。视觉层统一渲染 cyan card、可选正文 section、选项分组和 active row。

替代方案是新增独立 `permission` 或 `question` command surface kind。该方案语义最清晰，但会扩大类型、dispatcher 和测试改动面。当前业务行为仍是“选择一个选项”，继续使用 choice 更小。

### 3. 风险分类保留拦截能力，但停止向 UI 暴露 reason 文案

高危 bash 仍通过规则判断是否需要审批；命中规则后返回 title 和 command preview 即可。固定 reason 文案不再展示，因为它无法可靠覆盖组合命令、shell 展开、脚本内容和上下文副作用。

替代方案是保留 reason 但弱化样式。该方案不能解决“系统判断不准但看起来像权威结论”的问题。

### 4. 受限布局优先级：边框和提示 > selected option window > message

choice card 在高度不足时必须优先保留用户能做出选择的区域：顶部标题、当前选项窗口、操作提示、底部边框。permission 的 command message 是核心判断信息，但不能挤掉 `Deny` 或 feedback 路径；用户问题的 question message 也不能挤掉 answer 选项。空间不足时 message 可裁剪并显示 `truncated` 或省略提示。

替代方案是优先保留完整 command preview。该方案看似更安全，但长命令会导致用户无法看到全部可选动作，违背现有限高约束。

### 5. 视觉语言复用项目现有 cyan palette

permission gate 使用项目已有 cyan/teal 色系、细边框和 active row 高亮，不新增主题系统。command preview 使用低对比背景强调其代码属性；选中项使用 `▌` 和 `●` 强调焦点，未选项使用 `○` 和 muted 文本。

替代方案是直接套用当前 yellow choice box。该方案改动最小，但不能解决用户反馈的“难以一眼区分”和“不好看”。

## Risks / Trade-offs

- Choice card 增加 `messageTitle`、`messageStyle`、`optionsTitle` 等 UI 字段 → 这些字段只描述渲染结构，不承载 tool approval 或 question 业务语义。
- 删除 reason 可能减少系统解释性 → 用更强 command preview 呈现真实输入，让用户基于实际命令判断。
- Active row 背景和 code block 背景可能受终端主题影响 → 使用显式 256 色或 RGB ANSI，并保留 plain text 可读性。
- 长 command preview 裁剪可能隐藏关键尾部参数 → 受限布局中显示裁剪提示；实现时可优先保留开头和选中交互，后续如需要再增加横向窗口化。
- Inline feedback 的 cursor 计算更复杂 → 继续复用现有 inline input viewport 和 cursor row/column 测试。
