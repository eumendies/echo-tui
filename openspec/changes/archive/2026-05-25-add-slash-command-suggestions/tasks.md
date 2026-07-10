## 1. 命令元数据与输入事件

- [x] 1.1 扩展 command handler 类型，增加用户可见 `description` 元数据，并为 `/help`、`/model`、`/clear`、`/resume` 填写描述。
- [x] 1.2 在 input event 类型和 key parser 中新增 Tab 语义事件，识别 `\t` / `\x09`，并补充 key parser 单元测试。
- [x] 1.3 确保默认 slash handler 注册表可派生 `{name, description}` 提示项，且不维护第二份命令清单。

## 2. Slash suggestion 状态与事件路由

- [x] 2.1 新增 `SlashSuggestionContext` 或等价小型状态边界，基于 composer 文本和 handler metadata 派生候选项、当前选中项和可见状态。
- [x] 2.2 实现触发规则：仅在无 active command session、无 active response、单行 composer、文本以 `/` 开头且不含空格时显示，并按 slash 前缀过滤。
- [x] 2.3 在 app 输入事件路由中让 visible suggestions 优先消费 Up/Down/Tab；Up/Down 移动候选项，Tab 将当前候选纯命令写回 composer 且不追加空格。
- [x] 2.4 保持普通输入历史浏览、多行光标移动、active command session 事件处理和 response lock 的现有优先级不被破坏。

## 3. Footer 渲染

- [x] 3.1 扩展 render state，允许普通 composer 输入态携带 slash suggestion 列表与选中项。
- [x] 3.2 修改 footer layout，在没有 command surface 时渲染 composer、slash suggestion 列表和 hint，并保持 composer 光标可见。
- [x] 3.3 使用单行紧凑格式展示提示项，例如 `/model — 切换模型`，长文本按当前终端宽度安全截断。
- [x] 3.4 确保 suggestion 增加的 footer 行数纳入 pending preview 高度预算，避免 streaming preview 与 footer 互相覆盖。

## 4. 测试与文档

- [x] 4.1 新增/更新 app 集成测试，覆盖 `/` 显示全部命令、前缀过滤、Up/Down 选择、Tab 补全、Enter 提交补全后的纯命令、Esc 或编辑后隐藏提示。
- [x] 4.2 覆盖负向场景：普通文本不显示提示、带空格 slash 文本不显示提示、多行 composer 不显示提示、response 进行中不显示提示、active command session 不显示提示。
- [x] 4.3 更新 footer 渲染测试，验证 suggestion 列表在 composer 下方渲染、选中态可见、光标仍显示、长文本截断安全。
- [x] 4.4 更新 `docs/README.md`、`docs/tui-architecture.md` 和主 OpenSpec spec，说明 slash 命令提示和 Tab 补全交互。
- [x] 4.5 运行并通过 `npm run typecheck`、相关 targeted tests、`npm test`、OpenSpec strict validate 和 `git diff --check`。
