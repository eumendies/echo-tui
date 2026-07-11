## Why

`use_skill` 的 tool result 会携带完整 `SKILL.md` 正文，这是给模型继续执行任务使用的 provider-visible 内容；当前通用工具消息 renderer 会把这些正文原样显示到 transcript，导致用户界面噪音很大，也混淆了“模型可见内容”和“人类可读摘要”的边界。

这个变更让 `use_skill` 拥有专属 transcript 投影：用户只需要知道当前使用了哪个 skill，不需要看到 skill 指令全文或调用 arguments。

## What Changes

- 为 `use_skill` tool call / tool result 增加专属终端 transcript renderer。
- 成功的相邻 `use_skill` call/result pair SHALL 只显示简洁摘要：`Using skill · <skill-name>` 或等价文本。
- `use_skill` pending preview 或单独 tool call SHALL 使用同样的 `Using skill · <skill-name>` 摘要。
- 成功渲染时 SHALL NOT 展示 arguments、source path、skill 正文、resource 列表或原始 tool result body。
- 加载失败时 SHALL 保留短错误信息，避免用户完全失去诊断线索。
- 原始 transcript record、tool result 文本、provider continuation、session 持久化和 compaction 输入语义 SHALL 保持不变。
- 不引入 breaking change，不修改 `use_skill` tool definition 或 tool execution result 格式。

## Capabilities

### New Capabilities
- 无。

### Modified Capabilities
- `tool-message-rendering`: 新增 `use_skill` 专属可见投影要求，隐藏成功结果中的 skill 正文和 arguments，只显示正在使用的 skill 名称。

## Impact

- 影响 `src/render/tool-message-renderer.ts` 的工具 renderer 分发逻辑。
- 可能新增 `src/render/tool-message-renderers/use-skill.ts` 或等价 renderer 模块。
- 需要更新 transcript/tool message rendering 测试，覆盖成功、pending、失败和原始记录保持不变。
- 不影响 `src/tools/use-skill-tool-handler.ts` 的 provider-visible result 文本格式。
- 不新增运行时依赖，不改变 provider adapter 或 tool executor 行为。
