## Why

当前工具授权 UI 在 command preview 较长时信息层级不清晰，`Preview` 与 `Reasons` 混在普通 message 文本里，用户很难快速识别真正需要自行判断的命令内容。

风险原因由固定规则推断，面对复杂 shell command 容易不准确或误导用户；授权界面应突出 command preview 和明确操作选项，而不是展示不可靠的系统原因。

## What Changes

- 将通用 choice surface 优化为 card 风格：tool approval 突出 `PERMISSION` 标题、command 区块、action 选项区和操作提示；`ask_user_questions` 复用同一套 card 显示 question 与 answer 选项。
- 高危 bash 授权 UI 不再展示系统推断出的 reason 文案；风险分类仍决定是否需要授权，但用户判断依据主要是命令预览。
- command preview 使用更醒目的 code-like 区块，并在长内容或高度不足时保留裁剪提示。
- 授权选项保留现有语义和顺序：本次允许、会话级允许、允许所有工具、拒绝、向模型反馈。
- 保留现有 footer 高度限制和受限布局行为，长 preview 不得挤掉拒绝路径和关键选项。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `tool-approval`: 修改工具授权 UI 的可见展示要求，去除系统风险原因展示，改为统一 choice card 中的 permission 呈现，并保持高度受限行为。
- `interactive-choice-surface`: 修改通用 choice surface 的可见呈现，统一使用 card、section 和 bullet marker，不再要求旧数字编号样式。

## Impact

- `ToolApprovalContext` 的 approval surface 投影需要输出通用 choice card 字段，避免 renderer 解析 `Preview` / `Reasons` 文本。
- `UserQuestionContext` 需要把问题文本投影到同一套 choice card 字段，继续保留逐题分页和 `Other` 输入。
- `choice` surface 渲染需要统一为 card 风格，删除旧 yellow choice 渲染路径。
- `tool-risk-classifier` 仍保留风险匹配逻辑，但不再需要向 UI 暴露 reason 文案。
- 相关 render、app flow 和 risk classifier 测试需要更新，特别是长 command preview 的限高断言。
