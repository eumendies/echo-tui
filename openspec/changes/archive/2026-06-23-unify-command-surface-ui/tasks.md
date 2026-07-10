## 1. 共享 footer theme

- [x] 1.1 扩展 `src/render/footer/colors.ts`，导出共享 footer palette、active background 常量和必要的轻量样式 helper。
- [x] 1.2 将 `choice`、`composer/status`、`file_picker`、`resume`、`config`、`mcp`、`skills`、`scale`、`context` surface 中重复定义的 cyan/deep/bright/frame/muted/success/warn/danger 颜色迁移到共享 theme。
- [x] 1.3 统一 active row 背景使用共享 active background，避免 `backgroundRgb`、`background256(23)`、`background256WithForeground(24,117)` 等并存。

## 2. 焦点与 marker 统一

- [x] 2.1 更新通用 `select` surface：当前项使用 `▌` 焦点条、active 背景和 cyan 高亮，不再使用 `›`，也不为无 toggle 语义的 option 强加 `●/○` marker。
- [x] 2.2 更新通用 `checkbox` surface：checked/unchecked 使用 `●/○`，当前项使用 `▌` 焦点条，不再使用 `[x]/[ ]`。
- [x] 2.3 更新 slash suggestion 当前项视觉，使其与通用 select 的焦点语言一致，并保持 Tab 补全/上下选择语义不变。
- [x] 2.4 更新 `/resume` surface：panel focus 和 session 当前项使用 `▌`、active 背景和 cyan 高亮；移除 `▸/·` 和 inverse 焦点表达，不为 session 列表强加 `●/○` marker。
- [x] 2.5 将 `choice`、`file_picker`、`config`、`mcp`、`skills` 中已有 `▌` active row 迁移到共享 helper 或共享常量，保持视觉一致但不改变布局。
- [x] 2.6 确认不可选项、分隔线、错误提示和 preview 文本不会误用 `●/○`，继续使用弱化样式或非状态符号。

## 3. 文案语言统一

- [x] 3.1 中文化 footer renderer 默认文案：空状态、加载状态、默认 dismiss hint、filter hint、context hint、config/mcp/skills 默认说明等。
- [x] 3.2 统一 command handler 提供的常见 title、empty lines 和 dismiss hint 风格，保持“中文动作 + 英文按键/命令/路径/协议名”的规则。
- [x] 3.3 检查 `src/render/footer/` 和相关 command handler 中的用户可见字符串，保留必要英文技术名词，移除不必要的中英混杂句子。

## 4. 测试与验证

- [x] 4.1 更新 footer renderer 测试，覆盖通用 select、slash suggestion、resume、choice、file picker、config/mcp/skills 的 `▌` 焦点，以及 checkbox/toggle 类 surface 的 `●/○` marker 可见输出。
- [x] 4.2 更新相关 command handler 测试中对 dismiss hint、title、empty state 和 marker 的断言。
- [x] 4.3 增加或调整宽度约束测试，确保统一样式后的所有 footer 行仍不超过 safe render width。
- [x] 4.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.5 手动验证 `npm start` 下普通 composer、slash suggestion、`/model`、`/mode`、`/effort`、`/config`、`/mcp`、`/skills`、`/resume`、`/context`、`@` 文件选择器、choice/tool approval 的焦点、marker、颜色和文案一致性。
