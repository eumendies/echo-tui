## 1. Parser 与内部模型

- [x] 1.1 将 apply_patch 内部文件操作类型扩展为 `add | update | delete`，并更新相关 TypeScript 类型。
- [x] 1.2 支持解析 `*** Begin Patch` / `*** Delete File: <path>` / `*** End Patch` 删除语法。
- [x] 1.3 支持解析 unified diff 删除语法，包括 `--- a/<path>`、`+++ /dev/null` 和常见 `deleted file mode` metadata。
- [x] 1.4 保持 rename/move、mode/chmod change、binary patch 和 symlink patch 的拒绝语义。

## 2. 模拟、校验与写盘

- [x] 2.1 为 delete 操作实现路径、`.git`、NUL、文件存在性、普通文件、symlink、文本/NUL 内容和文件大小校验。
- [x] 2.2 为 unified diff 删除实现 hunk 内容校验，确保当前文件内容被确认删除为空内容后才允许删除。
- [x] 2.3 将 delete 操作纳入多文件 all-or-nothing 模拟流程，任一操作失败时不得写入、创建或删除任何文件。
- [x] 2.4 在写盘阶段对 delete 操作调用 unlink，并在删除前后正确调用 change history capture hooks。
- [x] 2.5 保持 explicit positive timeout、AbortSignal 和其他本地工具语义不受本变更影响。

## 3. Display metadata 与渲染

- [x] 3.1 将 `ApplyPatchDisplayFile.kind` 和 metadata 校验扩展为接受 `deleted`。
- [x] 3.2 为 Begin Patch 删除和 unified diff 删除生成 deleted 文件 metadata，原文件内容以 removed 行记录且 `postLine: null`。
- [x] 3.3 更新 apply_patch tool result renderer，使 deleted 文件标题、计数和 removed 行按删除语义展示。
- [x] 3.4 确保 renderer 不展示 `*** Delete File`、`deleted file mode`、`---`、`+++` 或 hunk header 等 patch 语法。

## 4. 授权 preview 与风险分类

- [x] 4.1 更新 apply_patch 授权 preview 摘要，使 Begin Patch 删除显示为 `delete <path>`、`- <path>` 或等价删除标记。
- [x] 4.2 更新 unified diff 删除的授权 preview 摘要，使 `+++ /dev/null` 删除明显区别于普通路径。
- [x] 4.3 保持 normal mode 下 apply_patch 执行前授权、plan mode 下 apply_patch 拒绝执行的既有风险分类语义。
- [x] 4.4 确保长路径和多文件删除 preview 仍遵守 footer 高度预算并保留可见删除提示。

## 5. Undo、测试与文档同步

- [x] 5.1 增加 apply_patch 删除已有文件后的 change history / `/undo` 恢复测试。
- [x] 5.2 增加 Begin Patch 删除、unified diff 删除、过期 hunk、缺失目标、目录、symlink、二进制/NUL、超限文件和 all-or-nothing 失败测试。
- [x] 5.3 增加 deleted metadata 与 TUI renderer 测试，覆盖删除文件标题、removed 行和 metadata fallback。
- [x] 5.4 增加 apply_patch 删除授权 preview 与 plan mode 拒绝测试。
- [x] 5.5 按实现结果同步 `docs/tui-architecture.md` 和相关归档后 specs。
- [x] 5.6 运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;` 和 `git diff --check`。
