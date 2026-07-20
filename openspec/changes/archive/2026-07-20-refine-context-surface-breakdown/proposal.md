## Why

当前 `/context` surface 将 System prompt、Memory 和 Skills 作为同级分类展示，但 Memory 与 Skills 实际都被注入同一条 system prompt。现有平铺口径容易让用户误以为三者是相互独立的 provider 输入区域，甚至认为统计发生了重复计算。

## What Changes

- 将 `/context` 的分类展示改为包含关系：System prompt 是顶层分类，Memory 与 Skills 是其子项。
- 顶层 composition bar 仅展示互不重叠的 System prompt、Tools、Messages 和 Reasoning，避免父子项在同一构成条中重复出现。
- System prompt 的展示 token 数包含基础系统指令、Memory 和 Skills；子项继续展示各自 token 明细。
- 保持 provider usage 总量、底层互斥 segment 估算和校准逻辑不变，仅在展示层构造层级投影。
- 明确小终端下优先保留 usage 总览和顶层分类，空间不足时优先裁剪 System prompt 子项。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `context-usage-command`: 调整 context usage 分类在详情 surface 中的层级、composition bar 及小终端裁剪口径。

## Impact

- 主要影响 `src/render/footer/context-surface.ts` 的展示投影、分类行和 composition bar 渲染。
- 需要更新 context surface 渲染测试和小终端约束测试。
- `ContextUsage` 类型、agent loop、provider usage 缓存和分类校准算法不需要改变。
