## Why

当前 `glob` 调用仍由通用 tool renderer 展示完整 arguments JSON 和原始逐行路径文本，用户难以快速辨认搜索模式、范围、结果数量及截断状态。`grep` 已建立结构化 display metadata 和专属投影模式，`glob` 可以沿用同一事实边界，为文件发现结果提供紧凑且稳定的终端展示。

## What Changes

- 为 pending、孤立 call 和相邻 call/result pair 增加 `Glob · “<pattern>”` 专属生命周期标题，并在第二行展示搜索 roots。
- 为成功、无匹配和 handler 截断结果附加有序 glob display metadata，保持 provider-visible result text 与执行语义不变。
- 将成功结果投影为有界的扁平文件路径树，使用低强调主题色、可计数省略节点和 safe-width fallback。
- 清晰区分 pending、成功、无文件、失败、handler 截断和 renderer 展示省略；历史或 malformed 记录继续使用通用 renderer。
- 增加执行、持久化和渲染测试，覆盖路径顺序、状态颜色、窄终端、宽字符、Tab、控制换行和原始 transcript 事实不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 要求成功 `glob` 结果携带有序、可持久化且不改变 provider-visible 文本的路径 display metadata。
- `tool-message-rendering`: 要求 `glob` 使用专属查询摘要、搜索范围、状态 marker 和有界扁平路径树进行终端投影。

## Impact

- 影响 `src/tools/glob-tool-handler.ts`、tool/transcript 类型和 session journal 中的可选 result details 字段。
- 新增 glob 专属 renderer，并接入现有 pair-aware tool message 分发和 footer pending preview。
- 更新 tool execution、transcript persistence 与 app renderer 测试。
- 不改变 `glob` schema、ripgrep 调用方式、结果上限、provider adapter、第三方依赖或历史 session 迁移要求。
