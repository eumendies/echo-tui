## 1. 数据和类型

- [x] 1.1 扩展 transcript session metadata 的 preview 数据结构，支持从 `records[]` 派生最近几条 role/text 摘要。
- [x] 1.2 更新 transcript store 和测试 fake store，使 `listSessions` 返回 bounded message preview 且不改变磁盘 session 格式。
- [x] 1.3 在 command surface 类型中新增专用 `/resume` 历史恢复 surface，保留通用 `select` surface 的现有结构。

## 2. 命令行为

- [x] 2.1 更新 `ResumeCommandHandler` 的 surface 构造逻辑，输出左侧 session item 和右侧 preview item。
- [x] 2.2 保持 `/resume` 的 Up/Down、Enter、Esc、空状态和 response lock 行为不变。
- [x] 2.3 为缺失 preview 或空文本 session 增加安全回退文案。

## 3. 渲染实现

- [x] 3.1 新增 footer resume surface renderer，渲染 cyan 两栏面板、选中行和 dismiss hint。
- [x] 3.2 将 `renderCommandSurface` 分发到新的 resume renderer。
- [x] 3.3 处理窄宽度、中英文宽字符和 ANSI 样式补齐，确保所有行不超过安全渲染宽度。

## 4. 测试和文档

- [x] 4.1 更新 command handler 测试，覆盖 surface kind、窗口移动、preview 更新和恢复确认。
- [x] 4.2 更新 app 集成测试，确认 `/resume` 打开专用 surface 且恢复后 transcript 语义不变。
- [x] 4.3 新增或更新 footer renderer 测试，覆盖两栏布局、选中态、空预览和窄宽度截断。
- [x] 4.4 如 README 或 docs 已说明 `/resume` UI，更新文档中的恢复列表和消息预览描述。

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`。
- [x] 5.2 运行 `npm test`。
- [x] 5.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 5.4 手动验证 `/resume`：空状态、多于 5 个 session 的窗口移动、右侧消息预览更新、Enter 恢复、Esc 取消和窄终端显示。
