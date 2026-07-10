## Why

当前 `apply_patch` tool result 只把增删背景补齐到最长编辑文本，多个文件和 hunk 又会被扁平展示，缺少稳定的文件分组、真实位置提示和有意义的上下文折叠。长 patch 因固定尾部截断容易隐藏后续修改，用户难以快速判断实际改动位置、范围和结果。

## What Changes

- 将 `apply_patch` result 按文件和 hunk 分组展示，并为文件显示路径及增删统计。
- 为编辑行增加单列定位 gutter：context 行显示修改后文件的真实行号，added/removed 行在同一列分别显示 `+`/`-`。
- added 行虽然以 `+` 替代可见行号，仍占用修改后文件行号；removed 行不占用修改后文件行号。
- 将新增和删除背景从定位 gutter 铺满至终端安全右边界，工具前缀保持中性。
- 在工具执行时记录完整、有序的文件展示行及实际 post-image 位置，确保 renderer 可以独立决定上下文折叠，且历史恢复不依赖再次读取目标文件。
- 按修改区块折叠未修改上下文，并在整体超过软显示预算时公平保留各文件和修改区块的摘要；最低结构超过预算时允许溢出，不得通过尾部截断隐藏后续修改。
- 直接采用当前完整 display metadata 结构，不引入 metadata 版本字段或兼容分支。
- 保持 provider-facing result text 和 patch 执行语义不变；解析失败而没有 metadata 时仍使用通用 tool result 渲染。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 扩展 `apply_patch` display-only metadata，记录实际定位、修改后行号推进所需信息和稳定的周边上下文。
- `streaming-llm-service-adapter`: 优化 `apply_patch` tool result 的文件分组、单列定位 gutter、整行背景和结构化折叠渲染要求。

## Impact

- 主要影响 `src/tools/apply-patch-tool-handler/`、`src/types/tool.ts`、`src/types/transcript.ts`、`src/render/tool-message-renderer.ts` 和 `src/render/tool-message-renderers/`。
- transcript session 会持久化扩展后的 display metadata，但 provider continuation 仍只消费原有 tool result 文本。
- 需要更新 apply-patch 工具执行、transcript 渲染和历史恢复相关测试，以及对应架构文档。
- 不引入第三方 TUI、diff 或终端渲染依赖。
