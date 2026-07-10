## 1. 类型与 Host 能力

- [x] 1.1 在 command 类型中新增 copy surface、copy item、copy session data 和 clipboard 写入结果类型。
- [x] 1.2 扩展 `CommandHost` 受控接口，新增读取可复制 user/assistant 消息快照的 transcript 能力。
- [x] 1.3 扩展 `CommandHost` 受控接口，新增结构化 clipboard 写入能力。
- [x] 1.4 在 command host 实现中从当前 transcript 投影 copyable records，过滤所有非 user/assistant 记录。

## 2. 剪贴板写入

- [x] 2.1 新增本地 clipboard 写入封装，支持 macOS `pbcopy`、Windows `clip` 和 Linux 常见工具检测/写入。
- [x] 2.2 将剪贴板写入成功、工具缺失和写入失败归一化为结构化结果。
- [x] 2.3 为 clipboard 封装添加单元测试，覆盖成功路径、不可用路径和错误信息归一化。

## 3. /copy 命令行为

- [x] 3.1 新增 `CopyCommandHandler`，注册 `/copy` 命令和 slash suggestion 描述。
- [x] 3.2 启动 `/copy` 时构建消息快照；无可复制消息时展示 info surface。
- [x] 3.3 打开 copy surface 时默认聚焦并选中最近 assistant 消息；不存在 assistant 时选中最近可复制消息。
- [x] 3.4 实现 ↑/↓ 移动、Space 切换选择、Esc 取消和 Enter 确认复制。
- [x] 3.5 实现复制内容格式：单条仅正文，多条按 transcript 顺序添加 `User:`/`Assistant:` 标题并用空行分隔。
- [x] 3.6 复制成功后关闭 command session 并展示本地成功反馈；复制失败时保持 surface 和选择状态并展示失败提示。

## 4. Copy Surface 渲染

- [x] 4.1 新增 `renderCopySurface`，使用两栏 footer 布局展示左侧单行消息预览和右侧全文预览。
- [x] 4.2 左侧列表使用 `▌` 表达当前焦点，使用 `●/○` 表达选中状态，并遵循共享 footer theme。
- [x] 4.3 右侧预览展示当前聚焦消息原文，遵守 safe render width、高度预算和裁剪策略。
- [x] 4.4 将 `copy` surface 接入 `renderCommandSurface` 分发。
- [x] 4.5 确保 copy surface 的标题、空状态、提示和错误文案以中文为主。

## 5. 测试与验证

- [x] 5.1 添加 command handler 测试，覆盖默认选择、过滤记录、多选、无选中确认、成功复制和失败保留选择。
- [x] 5.2 添加 copy surface renderer 测试，覆盖两栏布局、焦点 marker、选择 marker、长文本裁剪和窄宽度行为。
- [x] 5.3 添加 host 能力测试，确认 copyable records 只包含 user/assistant 且使用原始文本。
- [x] 5.4 更新帮助或 slash command 相关测试，确认 `/copy` 出现在默认命令集合中。
- [x] 5.5 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
