## 1. 文件选择器状态与文件索引

- [x] 1.1 设计并新增 file picker 状态类型，覆盖当前目录、query、trigger range、焦点、当前项、preview scroll、已选文件集合和提示信息。
- [x] 1.2 实现项目文件发现/目录树 helper，优先复用 ripgrep file listing 语义，过滤 `.git` 内部路径并限制结果数量。
- [x] 1.3 实现轻量文件类型判断，区分目录、文本、PDF、受支持图片和不支持文件，不在列表阶段完整读取大文件或解析 PDF。
- [x] 1.4 实现文本 preview 读取窗口，支持行号、滚动偏移、截断提示和读取失败提示。

## 2. 输入事件接入与 composer mention 操作

- [x] 2.1 在 app 输入分发中接入 file picker context，使其优先级位于 user question/tool approval 之后、slash suggestion 和普通 composer edit 之前。
- [x] 2.2 实现普通/计划模式下输入 `@` 打开 picker，并记录 composer trigger range；shell/shell-local 模式保持 `@` 普通输入。
- [x] 2.3 实现 picker active 期间普通字符、Backspace、Esc、方向键、Space、Enter、Left/Right 的事件语义。
- [x] 2.4 实现用一个或多个 `@path` mention 替换当前 trigger range，包含带空格路径的 quote 规则和光标更新。
- [x] 2.5 实现提交前解析 composer 中的 `@path` 与 `@"path with spaces"` mention，并对重复路径去重。

## 3. Footer surface 与 composer 高亮

- [x] 3.1 新增 `file_picker` command/render surface 类型，并接入 footer command surface 分发。
- [x] 3.2 实现两栏 file picker renderer，显示当前路径、已选文件摘要、文件/目录列表、preview 和操作提示，且不显示文件大小。
- [x] 3.3 实现列表 marker 与样式：已选、可选未选、不可选、当前焦点行，并在高度不足时窗口化当前项。
- [x] 3.4 实现文本/PDF/图片/不支持文件 preview 文案和 preview focus 下的上下滚动。
- [x] 3.5 在 composer 渲染层实现 `@file` mention 高亮，确保 ANSI 样式不影响光标坐标、自动换行和 padding。

## 4. 文件上下文展开与 provider 转换

- [x] 4.1 抽取或复用 `read_files` 的路径校验、媒体识别、文本/PDF/图片读取能力，供用户提交 mention 展开使用。
- [x] 4.2 在提交普通用户消息前生成 provider-facing 文件上下文文本，同时保持 visible transcript 使用原始 composer 文本。
- [x] 4.3 支持文本文件内容加入上下文，包含路径、类型、截断和读取失败信息。
- [x] 4.4 支持 PDF 文字提取加入上下文，不执行 OCR、页面渲染或 PDF 原始内容传递。
- [x] 4.5 支持受支持图片生成 user record 图片附件，并在上下文文本中只写附件 metadata，不写 base64。
- [x] 4.6 更新 OpenAI Responses、OpenAI Chat 和 Anthropic transcript converters，使 user record 图片附件转换为对应 provider 图片输入。

## 5. 测试与验证

- [x] 5.1 增加输入事件和 file picker 状态测试，覆盖 `@` 触发、`@query` 更新、Backspace、Esc、Space 多选、Enter 插入和 shell 模式不触发。
- [x] 5.2 增加 file picker renderer 测试或稳定纯函数测试，覆盖不显示文件大小、已选摘要、不可选文件、preview 文案和高度裁剪。
- [x] 5.3 增加 composer mention 高亮测试，验证输出含样式但 cursor row/column 与未高亮文本一致。
- [x] 5.4 增加 mention 提交展开测试，覆盖文本、PDF、图片、重复 mention、不可读文件和不支持文件。
- [x] 5.5 增加 provider converter 测试，覆盖 user record 图片附件在 OpenAI Responses、OpenAI Chat 和 Anthropic 中的投影。
- [x] 5.6 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 5.7 手动验证 `npm start` 下 `@` picker 打开/取消/多选/预览滚动/图片发送/resize 恢复和现有 slash suggestion、approval、ask_user_questions 流程不回归。
