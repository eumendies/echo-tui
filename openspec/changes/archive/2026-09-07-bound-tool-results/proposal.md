## Why

当前部分工具只限制结果条数而不限制返回文本总字节数，另一些工具仅在成功路径或单个输出流上限流，单条超大 `tool_result` 仍可能直接耗尽主模型或上下文压缩模型的窗口。工具结果必须在进入 transcript 和 provider 上下文之前由各自 handler 限制大小，使 compaction 只处理正常的历史累积，而不承担异常大原子记录的兜底职责。

## What Changes

- 为每个内置工具和 MCP 工具建立明确的 UTF-8 结果文本上限，覆盖成功、失败和异常路径。
- 为 `grep`、`glob` 等条目型工具同时保留条目上限和总字节上限，并在达到任一上限后停止继续收集结果。
- 修正 `run_bash_command` 的预算口径，使最终返回的 stdout、stderr、元数据和截断提示共享一个总输出预算。
- 对 `read_files`、网络工具、MCP 和可 offload 的长结果保留有界预览，并通过现有 tool-result artifact 暴露完整或受 artifact 上限保护的内容。
- 为 `run_subagent`、`use_skill`、Todo、用户提问以及文件编辑工具补齐适合其语义的长度校验或结果截断策略；不向模型返回不完整且可能改变执行语义的 skill 指令。
- 使工具定义和截断提示明确告知模型结果已受限，以及应使用分页读取、收窄查询或读取 artifact 的后续方式（对超限 skill 为分页读取其源文件）。
- 本次不引入统一的 `boundToolResult` 后处理层，也不修改 compaction 的最近消息保留策略；限制由各工具生产结果的边界负责。

## Capabilities

### New Capabilities

- `bounded-tool-results`: 规定所有工具在进入 transcript/provider 上下文前必须产生有界结果，并定义各类工具的截断、分页、offload 和拒绝语义。

### Modified Capabilities


## Impact

- 影响 `src/tools/` 下所有内置工具 handler、结果格式化器和 tool-result offloading 接入点。
- 影响 `src/mcp/tool-adapter.ts` 的失败路径，以及 `use_skill`、`run_subagent`、Todo 和用户提问等当前未统一限制的特殊执行路径。
- 部分默认上限会收紧，尤其是 `read_files` 的单次文本结果和 `run_bash_command` 的双流合计结果；调用方需要通过分页、收窄范围或 artifact 获取更多内容。
- 不新增第三方依赖，不改变 provider 协议，也不改变 transcript/compaction 数据模型。
