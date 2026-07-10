## 1. 授权数据模型

- [x] 1.1 为 tool approval surface 增加 permission gate 语义字段，避免 renderer 解析 `Preview` / `Reasons` 文本。
- [x] 1.2 调整 `ToolApprovalContext` 的 surface 投影，使高危 bash 授权传递 command preview，不再拼接 reason message。
- [x] 1.3 调整风险分类返回值或消费路径，保留审批判定但不再向 UI 暴露系统 reason 文案。

## 2. Permission Gate 渲染

- [x] 2.1 在 choice renderer 中为 permission gate 增加专用卡片投影，包含授权标题、command 区块、action 区块和操作提示。
- [x] 2.2 使用项目现有 cyan/teal 视觉语言渲染边框、section rule、code-like command preview、active row 和 muted rows。
- [x] 2.3 保持现有选项顺序、selectedIndex、inline feedback 输入和 cursor row/column 语义。

## 3. 高度受限布局

- [x] 3.1 将 permission gate 接入现有 `maxLines` 预算，确保 footer layout 仍不超过 `rows - 2`。
- [x] 3.2 在高度不足时优先保留标题、选项窗口、拒绝路径、操作提示和底部边框。
- [x] 3.3 为长 command preview 提供裁剪或省略提示，避免长命令进入 scrollback 或挤掉 action 区。

## 4. 测试与验证

- [x] 4.1 更新 app flow 测试，覆盖高危 bash 授权 surface 不再包含 reason 文案且仍能 allow/deny/feedback。
- [x] 4.2 更新 render 测试，覆盖 permission gate 标题、command 区块、action 区块、active row 样式和长 command 限高。
- [x] 4.3 更新 risk classifier 测试，覆盖高危命令仍需要审批但不要求返回 reason 文案。
- [x] 4.4 运行 `npm run typecheck`。
- [x] 4.5 运行 `npm test`。
- [x] 4.6 运行 `find bin src test -name '*.js' -exec node --check {} \;`。

## 5. 统一 Choice Card 迁移

- [x] 5.1 将 choice surface 类型从 permission 专用 `variant` / `preview` 调整为通用 `messageTitle`、`messageStyle`、`optionsTitle` 字段。
- [x] 5.2 将 tool approval 和 `ask_user_questions` 都投影为统一 choice card，保留原交互语义、分页和内联输入。
- [x] 5.3 删除旧 yellow choice renderer，让所有 choice surface 使用新的 cyan card renderer。
- [x] 5.4 更新 OpenSpec delta，覆盖通用 choice card 和用户问题迁移后的可见行为。
- [x] 5.5 更新 app/render 测试，覆盖 permission、question、普通 choice 和 inline input。
- [x] 5.6 重新运行 typecheck、测试、JS syntax check 和 diff check。
