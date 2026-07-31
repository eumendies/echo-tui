## Why

`grep` 是高频本地观察工具，但当前 tool call 会暴露原始 arguments JSON，结果也只能通过通用文本 renderer 展示，长查询、多路径和大量命中时层级不清、终端噪音较大。为使代码搜索过程更易读、可审计且与现有 Web Search、Bash、文件编辑专属投影保持一致，需要为 `grep` 增加面向代码搜索场景的专属 renderer。

## What Changes

- 为 pending、孤立 `grep` call 和相邻匹配的 call/result pair 增加专属终端投影，以查询摘要、搜索范围和生命周期状态替代完整 arguments JSON。
- 将成功结果按文件分组，使用树形连接、行列 gutter 和低强调主题色展示有界匹配片段。
- 为无匹配、失败、结果截断和 renderer 自身省略提供清晰且互不混淆的状态表达。
- 为 `grep` 成功结果增加可持久化的结构化 display metadata，renderer 不再从存在歧义的 `path:line:column: text` 文本反向解析匹配项；provider-visible result 文本保持不变。
- 对非法 arguments、缺失或非法 display metadata 采用通用 tool renderer 安全降级，并保持 safe render width、Tab 展开和 transcript 事实不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tool-message-rendering`: 增加 `grep` 查询摘要、文件分组结果树、代码 gutter、低强调结果样式、状态、预算和安全降级要求。
- `local-tool-execution`: 要求成功的 `grep` result 在不改变 provider-visible 文本的前提下携带结构化匹配 display metadata，供终端 renderer 和会话重放使用。

## Impact

- 主要影响 `src/render/tool-message-renderer.ts`、新增的 `src/render/tool-message-renderers/grep.ts`、`src/tools/grep-tool-handler.ts` 以及 tool/transcript 类型定义。
- `grep` tool result 的结构化 details 将新增可选 display metadata；原始 result text、工具 schema、执行语义和 provider continuation 不发生破坏性变化。
- session journal 将持久化新增 metadata；缺少 metadata 的历史记录继续安全降级，无需迁移。
- 需要扩展 renderer、tool execution 和 transcript persistence 自动化测试；不引入第三方依赖。
