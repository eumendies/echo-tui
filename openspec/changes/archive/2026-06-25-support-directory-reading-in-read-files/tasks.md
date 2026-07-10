## 1. 目录读取核心逻辑

- [x] 1.1 为 `read_files` limits 增加单目录最大返回条目数，并保持现有 `files[]`、文本、图片和 PDF 输入语义不变
- [x] 1.2 在路径分类中把目录交给专用 directory reader，返回 `kind: directory` 的成功 envelope
- [x] 1.3 实现直接子项枚举、`.git` 排除、按名称稳定排序，以及 `file` / `directory` / `symlink` / `other` 类型识别
- [x] 1.4 为目录项生成可复用的子路径，并仅为当前页普通文件返回 `size_bytes`
- [x] 1.5 实现目录 `offset` / `limit` 分页、内置条目上限、空目录、`total_entries`、`returned_entries`、`has_more` 和 `recursive: false` metadata
- [x] 1.6 处理目录不可读和条目 metadata 竞态，保持批量读取的部分成功及总输出截断语义

## 2. 工具职责和文档

- [x] 2.1 更新 `read_files` tool description，明确支持已知目录的非递归直接子项读取及目录分页语义
- [x] 2.2 更新内置 system prompt，明确 `read_files`、`glob` 和 `grep` 的职责边界
- [x] 2.3 更新 `docs/tui-architecture.md` 中的 `read_files` 能力、目录输出字段和限制说明

## 3. 自动化验证

- [x] 3.1 更新 schema 和既有目录错误测试，使目录路径按新契约返回成功结果
- [x] 3.2 添加目录读取测试，覆盖文件/目录/符号链接/隐藏项类型、普通文件大小、稳定排序和 `.git` 排除
- [x] 3.3 添加目录分页和限制测试，覆盖 offset、limit、默认上限、显式超大 limit、空目录、has_more 和总输出截断
- [x] 3.4 添加混合批量及失败测试，覆盖文件与目录同时读取、不可读或不存在路径以及成功结果保留
- [x] 3.5 更新 system prompt 或工具定义测试，验证模型可见描述包含目录读取边界
- [x] 3.6 依次运行 `npm run typecheck`、`npm test` 和 JavaScript 批量语法检查

## 4. 交互验证

- [x] 4.1 使用真实或 fake agent 调用 `read_files` 读取普通目录，确认模型能根据返回路径继续读取子文件或子目录
- [x] 4.2 验证大型目录分页、空目录、目录与文件混合读取，以及结果在 TUI tool call/result 中可读

## 5. Reader 模块整理

- [x] 5.1 从 `readers.ts` 提取 directory、text 和 image reader，保留路径分派、PDF 和公共结果格式化逻辑
- [x] 5.2 验证重构前后的 `read_files` 工具契约和 TUI 投影保持不变

## 6. 目录 mention 一致性

- [x] 6.1 让 `formatSelectedFileForModel` 将目录成功结果投影为有界直接子项上下文，而不是 unavailable
- [x] 6.2 允许 file picker 通过 Enter 插入目录 mention、通过 Space 多选目录，并保留 Right 进入目录
- [x] 6.3 增加手动目录 mention、目录省略提示、picker 插入和目录多选测试
- [x] 6.4 运行完整验证并确认 OpenSpec strict validation 通过
