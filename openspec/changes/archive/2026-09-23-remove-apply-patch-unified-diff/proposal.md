## Why

`apply_patch` 同时接受 unified diff 和 `*** Begin Patch`，导致解析、模拟及审批摘要必须维护两套输入语义。现有 Begin Patch 已覆盖新增、更新、删除和多文件操作，保留统一 diff 输入不再值得这部分维护成本。

## What Changes

- **BREAKING**：`apply_patch` 仅接受 `*** Begin Patch` / `*** End Patch` 的 Add/Update/Delete File 输入；独立 unified diff 或混入的 git 文件段返回失败，不修改文件。保留 Begin Patch 更新块内的数字 `@@` 头。
- 移除 unified diff 专用解析、匹配及审批路径提取；工具调用标签只提取 Begin Patch 文件指令，删除操作仍有醒目标记。
- 工具 definition 和 provider-visible schema 只说明 Begin Patch 格式；保留现有审批、文件安全检查、all-or-nothing、change history、undo 与结果展示语义。
- 不为旧会话中的 unified diff 调用建立转换或重新执行兼容逻辑；本次不改会话格式。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `local-tool-execution`：限定 `apply_patch` 的输入语法，保留 Begin Patch 更新块、文件操作及安全边界。
- `tool-approval`：审批摘要和工具调用标签仅识别 Begin Patch 文件指令，不把 unified diff 文件头展示成有效目标。
- `streaming-llm-service-adapter`：对模型暴露的 `apply_patch` 参数说明不再宣称支持 unified diff。

## Impact

- 影响 `src/tools/apply-patch-tool-handler/` 的 parser、simulator、调用标签及工具 definition，以及 `src/app/tool-approval/projection.ts` 的路径摘要。
- 需要调整 `test/tools/`、`test/app/`、`test/render/` 内使用 unified diff 作为 apply_patch 输入的用例，更新 `docs/tui-architecture.md`。
- `src/app/diff/` 中供 `/diff` 使用的统一差异解析及文件编辑结果 display metadata 不在移除范围；不引入新依赖。
