## 1. apply_patch handler 与 unified diff 子集

- [x] 1.1 新增 `src/tools/apply-patch-tool-handler.ts`，定义 `apply_patch` tool name、schema、默认安全上限和 handler 工厂。
- [x] 1.2 实现 unified diff 子集 parser，支持可选 `diff --git` header、`---` / `+++` 文件头、`/dev/null` 新增文件、多文件和多 hunk。
- [x] 1.3 实现不支持 patch 类型检测，拒绝删除文件、rename/move、mode/chmod、binary patch 和 symlink patch。
- [x] 1.4 实现 patch 输入校验，覆盖空 patch、非 string patch、格式缺失、目标路径缺失和 hunk 格式错误。
- [x] 1.5 兼容 agent CLI 常见的 headerless update patch：同路径 `diff --git` 后可直接跟 `@@` hunk。
- [x] 1.6 兼容 agent CLI 常见的 `*** Begin Patch` 格式，支持 `Add File` 和 `Update File`。

## 2. 安全应用与文件写入

- [x] 2.1 实现路径解析和基础路径拒绝：相对路径按 cwd 解析，允许绝对路径和 `..`，拒绝 NUL 和 `.git` 内部路径。
- [x] 2.2 实现新增文件 apply 逻辑：目标不存在、必要时创建父目录、写入 UTF-8 文本内容。
- [x] 2.3 实现更新文件 apply 逻辑：读取 UTF-8 文本文件，基于 context + removed lines 做精确唯一 hunk 匹配并应用 new lines。
- [x] 2.4 实现 all-or-nothing 应用流程：全部 parse/validate/apply 在内存中成功后才写入，任一失败不写入任何文件。
- [x] 2.5 实现 patch bytes、单文件 bytes、changed files 数量和 hunk 数量等内置安全上限。
- [x] 2.6 实现成功和失败 tool result 文本，成功返回 changed files summary，失败返回简洁 reason 和可重试 hint。

## 3. 默认注册与 agent 指引

- [x] 3.1 在默认 tool registry 中注册 `apply_patch`，保持 `run_bash_command` 现有注册和配置行为不变。
- [x] 3.2 更新内置 system prompt，引导模型常规源码、测试和文档修改优先使用 `apply_patch`，bash 继续用于观察、搜索、验证和必要命令执行。
- [x] 3.3 确认 OpenAI provider request 自动包含 `apply_patch` function tool schema，且 provider agent 不执行 patch 逻辑。

## 4. 测试覆盖

- [x] 4.1 增加工具单测，覆盖 update file、add file、多文件、多 hunk 成功路径。
- [x] 4.2 增加工具单测，覆盖允许绝对路径和 `..` 工作目录外路径，以及拒绝 NUL 和 `.git` 路径。
- [x] 4.3 增加工具单测，覆盖 hunk 匹配 0 次、多次匹配、目标不存在、目标已存在和格式错误。
- [x] 4.4 增加工具单测，覆盖删除、rename/move、mode/chmod、binary patch、symlink patch 等不支持类型。
- [x] 4.5 增加工具单测，覆盖任一失败时不写入任何文件的 all-or-nothing 语义。
- [x] 4.6 更新 registry/tool-executor/OpenAI request 测试，确认默认工具定义包含 `apply_patch`，tool loop 可以执行并回传结果。
- [x] 4.7 增加 headerless update patch 单文件与混合多文件测试。
- [x] 4.8 增加 Begin Patch Add File、Update File、拒绝 Delete File 和 all-or-nothing 测试。

## 5. 文档、规格与验证

- [x] 5.1 更新 docs，说明 `run_bash_command` 与 `apply_patch` 的职责分工和 patch 格式范围。
- [x] 5.2 同步主 specs：`local-tool-execution` 和 `streaming-llm-service-adapter`。
- [x] 5.3 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 5.4 回填本 tasks 清单并运行 OpenSpec validate，确认 change 可 apply 和后续 archive。
