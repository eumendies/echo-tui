## Why

当前本地工具授权只覆盖 `apply_patch`，但 `run_bash_command` 可以通过 `rm -rf`、shell 重定向、`sed -i`、包管理安装、破坏性 git 命令等方式删除或修改文件。需要在真正执行本地工具前对高危调用做统一风险识别和用户确认，避免模型在未显式授权时执行破坏性操作。

## What Changes

- 新增高危工具调用风险分类能力，对 tool call 的工具名和参数进行 provider-neutral 风险评估。
- 将 `apply_patch` 从硬编码工具名授权升级为风险分类中的写入类工具授权。
- 对 `run_bash_command` 的常见高危命令模式触发授权，包括删除/移动/复制/权限修改、shell 写入重定向、原地编辑、包管理安装、破坏性 git 操作和远程脚本执行。
- 扩展工具授权请求的展示信息，让 choice surface 能展示风险原因和 bash command 预览。
- 用户拒绝高危工具调用时仍生成对应 tool result 参与 continuation，保持模型工具调用协议完整。
- 第一版不实现完整 shell sandbox、不做 session 级授权、不做用户自定义 policy，也不把风险拦截下沉到具体 tool handler。

## Capabilities

### New Capabilities
- `high-risk-tool-approval`: 定义高危 tool call 风险分类、授权拦截、bash 高危模式和拒绝结果语义。

### Modified Capabilities
- `tool-approval`: 从仅拦截 `apply_patch` 扩展为可承载风险原因和命令预览的通用工具授权交互。
- `local-tool-execution`: 默认 bash 工具执行前 SHALL 支持通过上层风险分类拦截常见高危命令模式。
- `streaming-llm-service-adapter`: agent loop runtime SHALL 在调用普通 tool executor 之前执行风险分类，并对需要授权的高危调用等待 app 授权。

## Impact

- 影响 `src/agent/agent-loop-runtime.ts`：以风险分类结果替代单一 `requiresToolApproval()` 判断，并在 executor 前处理高危授权。
- 新增或扩展 `src/tools/tool-risk-classifier.ts`：集中维护 provider-neutral 工具风险分类和 bash command 模式识别。
- 影响 `src/types/agent.ts`：扩展 tool approval callback/request 展示元数据类型。
- 影响 `src/app/tool-approval-context.ts`：展示风险原因、命令预览和更明确的授权标题/说明。
- 影响测试：新增 classifier 单元测试、agent loop 高危 bash 授权/拒绝测试、app approval 展示测试，并更新现有 apply_patch 授权测试。
