## Why

`read_files` 当前会拒绝目录路径，但模型经常把读取已知路径理解为同时适用于文件和目录，导致无效工具调用后再退回 bash。现有 `glob` 只发现文件，无法稳定表达目录的直接子项、空目录和文件类型，因此需要为 `read_files` 补充结构化且有界的目录读取能力。

## What Changes

- `read_files` 接收目录路径时返回该目录的直接子项，不再把目录统一视为错误。
- 目录读取只列出一层，不递归读取后代，也不自动读取子文件内容。
- 目录项返回可继续用于工具调用的相对路径、条目类型，以及普通文件的字节大小。
- 目录结果返回稳定排序、分页范围、返回条目数、总条目数和 `has_more`，并继续受总输出大小限制。
- 目录读取排除 `.git` 内部路径，并对不可读目录、特殊文件和批量部分失败返回明确结果。
- composer `@` mention 支持引用目录，并将有界的直接子项作为 provider-facing 上下文。
- file picker 允许通过 Enter 或 Space 插入、选择目录 mention，同时保留 Right 进入目录的浏览语义。
- 更新工具描述、系统提示和架构文档，明确 `read_files`、`glob`、`grep` 的职责边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 扩展 `read_files` 的路径读取契约，使其支持有界、非递归的目录直接子项读取。
- `composer-file-picker-context`: 扩展目录 mention 的选择和提交上下文语义。

## Impact

- 影响 `src/tools/read-files/` 中的路径分类、目录读取、结果 envelope 和限制逻辑。
- 影响 `src/app/utils.ts` 的 mention 上下文投影，以及 file picker 的目录选择与提示。
- 影响 `read_files` provider-visible tool description，但不改变现有 `files[]` 参数结构、tool result 类型或 transcript schema。
- 需要更新 `test/tools/tool-execution.test.js`、系统提示测试、架构文档及 `local-tool-execution` 规格。
- 不引入新的运行时依赖，也不改变 `glob`、`grep` 和文件读取的既有行为。
