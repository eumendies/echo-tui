## Why

当前真实 agent 只有 `run_bash_command`，已经能读取、搜索和验证，但文件修改仍只能通过 shell 命令间接完成，容易出现整文件覆盖、部分写入和不可审计的修改方式。需要新增一个专门的 patch 编辑工具，让 agent 以常见 patch 格式修改文本文件；路径权限和更细粒度安全策略后续由独立模块补齐。

## What Changes

- 新增默认本地工具 `apply_patch`，输入为 `{ "patch": "<patch text>" }`。
- `apply_patch` 支持 unified diff 子集，以及 `*** Begin Patch` / `*** Add File` / `*** Update File` 格式；可更新已有文本文件、新增文本文件、多文件 patch、多 hunk patch。
- 第一版明确不支持删除、重命名/移动、mode/chmod、binary patch、symlink patch。
- 工具执行时 SHALL 允许绝对路径；相对路径 SHALL 按当前工作目录解析。第一版仅做基础路径校验，拒绝 NUL 路径和 `.git` 内部路径。
- hunk 应用 SHALL 基于 context + removed lines 的精确唯一匹配；unified diff 行号可解析但不得作为唯一可信依据。
- patch SHALL 以 all-or-nothing 方式应用：任一文件或 hunk 失败时，不写入任何文件。
- 默认真实 tool registry SHALL 同时暴露 `run_bash_command` 和 `apply_patch`。
- 内置 system prompt 和文档 SHALL 建议常规源码/测试修改优先使用 `apply_patch`，bash 继续负责观察、搜索、验证和命令执行。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `local-tool-execution`: 新增 provider-neutral 的 `apply_patch` 本地工具及其安全边界、支持的 patch 格式和执行结果语义。
- `streaming-llm-service-adapter`: 默认真实 agent 的工具 registry 需要暴露 `apply_patch`，OpenAI 请求可以发送该工具 schema，并继续由 agent loop runtime 执行工具 loop。

## Impact

- 新增 `src/tools/apply-patch-tool-handler.ts` 或等价模块。
- 修改 `src/tools/tool-registry.ts`，默认注册 `apply_patch`。
- 可能更新 `src/agent/system-prompt.ts`，引导模型常规文件修改优先使用 `apply_patch`。
- 影响工具执行测试、OpenAI request/tool schema 测试、文档和 OpenSpec 主 spec。
- 不新增第三方依赖，不 shell out 到 `git apply` 或系统 `patch`，不改变 `RunAgent(records, callbacks)` app contract。
