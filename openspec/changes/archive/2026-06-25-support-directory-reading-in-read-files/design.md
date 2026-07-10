## Context

`read_files` 已经使用统一的 `files[]` 输入和文件 envelope 支持文本、图片及 PDF，但 `readOneFile()` 在 `stat.isDirectory()` 时直接返回失败。模型通常把工具名理解为“读取已知路径”，因此目录误调用会额外消耗一次工具往返；与此同时，现有 `glob` 只返回匹配文件，不能表示直接子目录、空目录或条目类型。

这次变更需要在不增加新工具、不改变 provider-neutral tool result 类型、也不引入递归扫描的前提下，让目录路径成为 `read_files` 的一种合法资源类型。目录输出仍需遵守批量部分成功、`.git` 拒绝和总输出截断等现有边界。

## Goals / Non-Goals

**Goals:**

- 让 `read_files` 对目录路径返回一层直接子项，并允许文件与目录混合批量读取。
- 为模型提供可直接继续调用的子项路径、条目类型和普通文件大小。
- 让目录结果具备稳定排序、`offset` / `limit` 分页、条目数量和 `has_more`。
- 对大型目录、不可读目录、特殊文件和输出截断提供明确、有界的结果。
- 保持现有文本、图片、PDF、路径解析和附件语义不变。

**Non-Goals:**

- 不递归遍历目录，不计算后代数量或目录总大小。
- 不自动读取目录中的文件内容，不生成内容摘要、hash 或修改时间。
- 不让目录读取承担 glob 模式匹配或 grep 文本搜索。
- 不新增 `list_directory` 工具，不改变 `files[]` 参数结构或 transcript schema。
- 不解析符号链接目标，也不通过符号链接绕过既有 `.git` 路径拒绝规则。

## Decisions

### 1. 将目录作为 `read_files` 的一种资源类型

`readOneFile()` 完成路径解析和 stat 后，目录将进入专用 directory reader，返回 `kind: directory` 的现有文件 envelope。批量请求仍按输入顺序处理，每个路径生成独立 envelope；单项目录读取失败只会令整体 `ok` 为 `false`，不会隐藏其他成功结果。

选择扩展 `read_files`，而不是新增 `list_directory`，是为了直接容忍模型已经发生的目录调用，并保持“读取一个或多个已知路径”的统一入口。新增工具虽然职责更单一，但会增加工具选择歧义，不能消除现有误调用。

### 2. 目录读取严格限制为直接子项

directory reader 只执行一次目录枚举，不进入任何子目录，也不读取子文件内容。结果包含每个直接子项的：

- `path`：基于请求路径拼接出的可复用路径；相对请求保持相对形式，绝对请求保持绝对形式。
- `kind`：`file`、`directory`、`symlink` 或 `other`。
- `size_bytes`：仅普通文件提供。

不返回 mtime、权限、owner、hash 或内容摘要。这些字段对模型定位源码的收益较低，会制造平台差异、动态噪音或额外 I/O。

### 3. 使用名称的确定性字典序，并在排序后分页

目录项先排除名称为 `.git` 的直接子项，再按名称进行确定性字典序排序，最后应用 `offset` 和 `limit`。不按类型分组，避免目录项类型变化导致同名附近条目的分页位置发生额外变化。

目录语义下，`offset` 表示 0-based 条目偏移，`limit` 表示最多返回条目数。省略 `limit` 时使用内置的目录条目上限；显式 `limit` 也不得突破该安全上限。结果明确返回请求范围、实际返回数量、可见总条目数和 `has_more`，让模型可以继续分页。

文本文件继续沿用按行解释 `offset` / `limit`；图片和 PDF 继续忽略这两个字段。

### 4. 复用总输出限制，并增加目录条目上限

目录读取增加独立的单目录最大返回条目数，防止大型目录生成无界 envelope。总输出仍由 `maxTotalOutputBytes` 统一截断并标记 `truncated`。目录枚举需要获得直接子项集合才能稳定排序并计算 `total_entries`，但不会执行递归 stat；只为当前页中的普通文件获取大小 metadata。

相比流式枚举，完整读取直接子项能提供稳定排序和准确 `total_entries`，实现也更简单。代价是极端大单层目录会占用与条目数成正比的临时内存，但仍远小于递归扫描风险，且输出保持有界。

### 5. 明确与 glob 和 grep 的职责边界

provider-visible 描述和系统提示将明确：

- `read_files`：读取已知文件，或查看已知目录的直接子项。
- `glob`：按文件名或路径模式发现文件。
- `grep`：在文本内容中搜索匹配。

这样目录支持是容错和结构观察能力，不取代模式发现与内容搜索。

### 6. `@` 目录 mention 复用目录 reader 的有界结果

composer 提交时继续通过 `readOneFile()` 统一读取 mention。目录成功结果不进入文件内容 fence，而是压缩为 `selected_directory` section，只保留直接子项行；当目录结果存在 `has_more: true` 时追加简洁的省略提示，不透传 offset、limit、大小上限等 verbose metadata。

file picker 将目录标记为 selectable：Enter 插入当前目录 mention，Space 可将目录加入多选集合；Right 仍优先执行进入目录。这样手动输入、picker 和 `read_files` 对目录路径保持一致，同时不改变现有浏览按键。

## Risks / Trade-offs

- [Risk] 模型可能误以为目录读取会递归展示完整树 → 在 tool description、结果 metadata 和规格中明确 `recursive: false`，只返回直接子项。
- [Risk] 大型单层目录仍需读取全部 Dirent 才能排序和计算总数 → 不递归，限制单页返回条目，并继续使用总输出上限。
- [Risk] 读取目录后条目发生变化会导致跨页重复或遗漏 → 采用每次调用时的稳定排序，但不提供目录快照；这是本地文件系统观察工具可接受的最终一致性。
- [Risk] 获取文件大小时条目被删除或类型变化 → 将该条目标记为 `other` 或省略大小，不因单个条目 metadata 竞态中断整个目录结果。
- [Risk] 符号链接可能指向目录或 `.git` → 只报告 `symlink`，不解析目标；用户显式读取后续路径时继续经过现有路径拒绝和文件类型判断。
- [Risk] 用户误以为 `@目录` 会递归附加完整目录树 → mention 上下文明确标记为直接子项，并沿用 directory reader 的单目录条目上限。
