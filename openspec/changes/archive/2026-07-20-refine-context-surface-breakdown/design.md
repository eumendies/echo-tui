## Context

agent loop 当前从 provider request 快照估算六个互斥 segment：`system`、`memory`、`skills`、`tools`、`messages` 和 `reasoning`，再将它们校准到 provider 返回的 `usageInputTokens`。其中 `system` 已经扣除了 Memory 和 Skills，因此底层 segment 总和不会重复。

但真实请求中 Memory 与 Skills 都由 `createBuiltInSystemPrompt(...)` 拼入同一条 system record。context surface 直接把六个互斥统计 segment 平铺，并将 `system` 标为“系统提示词”，混淆了“便于求和的内部分类”和“provider 请求的内容结构”。

## Goals / Non-Goals

**Goals:**

- 让 surface 准确表达 System prompt 包含 Memory 与 Skills。
- 保证 composition bar 只使用互不重叠的顶层分类。
- 继续使用最近一次 provider usage 和现有校准结果，不改变统计真值来源。
- 在小终端中优先保留总览与顶层信息，再裁剪子项明细。

**Non-Goals:**

- 不改变 `ContextUsage`、`ContextUsageSegment` 或 provider adapter 协议。
- 不修改 token estimator、segment 校准算法或 context usage 缓存生命周期。
- 不提高统计到 provider tokenizer 级别的精度。
- 不调整 `/context` 的打开、关闭和无 usage 提示行为。

## Decisions

### 1. 保持底层互斥 segment，在渲染层构造层级投影

renderer 按 category 读取现有 segment，并计算：

```text
systemPromptTokens = system.tokens + memory.tokens + skills.tokens
```

顶层展示数据由 System prompt、Tools、Messages 和 Reasoning 组成；Memory 与 Skills 保留为 System prompt 的子项。这样底层仍满足 segment 总和等于 provider used tokens，展示层则准确表达实际请求结构。

备选方案是把 `system` segment 改成包含 Memory 和 Skills 的总量，并引入嵌套数据结构。该方案会破坏现有总和不变量，并扩大 agent loop、类型和缓存协议的改动范围，因此不采用。

### 2. composition bar 只绘制顶层互斥分类

composition bar 使用 System prompt 聚合值、Tools、Messages 和 Reasoning，四者之和仍等于 `usedTokens`。Memory 与 Skills 不在 bar 中再次占据区段，只在 breakdown 中作为子项展示。

顶层 breakdown 使用固定语义顺序，而不是按 token 数排序：System prompt、Tools、Messages、Reasoning。固定顺序可以让父子结构稳定，并避免不同请求间分类位置跳动。

### 3. 父项展示全局占比，子项仅展示 token 明细

System prompt 顶层行展示聚合 token 数及其占全部 used tokens 的比例；Memory 与 Skills 子项缩进显示 token 数，不再显示全局百分比，避免用户将父项和子项百分比相加。

预期结构如下：

```text
● 系统提示词                 15.3K  28%
  ├─ Memory                  2.5K
  └─ Skills                  3.0K
● 工具                       21K  39%
● 消息                     14.5K  27%
● 推理                        6K  11%
```

值为零的顶层分类和子项继续省略。Memory 或 Skills 仅有一个非零项时，分支符号应保持结构可读，但不要求补绘值为零的兄弟项。

### 4. context surface 按信息优先级分配行预算

完整布局先生成 usage header、window gauge、composition bar、顶层 breakdown、System prompt 子项、关闭提示与边框。行数不足时先移除 Memory 与 Skills 子项，再减少次要留白；最终仍由 footer 的安全宽度和最大行数约束兜底。

这比直接从 layout 头部裁剪更符合信息优先级，避免新增层级后更容易丢失标题或 usage 总览。

## Risks / Trade-offs

- [Risk] System prompt 父项和子项同时出现时，明细行 token 不参与顶层求和，用户仍可能误读。 → 使用缩进与树形分支明确包含关系，并且子项不展示全局百分比。
- [Risk] composition bar 不再单独显示 Memory 与 Skills 的颜色区段，细分类可视性降低。 → 在 breakdown 子项中保留各自标签和颜色，bar 专注表达顶层构成。
- [Risk] 专用行预算逻辑增加 renderer 复杂度。 → 仅为 context card 定义简单优先级，不修改通用 footer window API。
- [Risk] 老测试依赖按 token 降序的分类行。 → 更新测试为断言固定顶层顺序、父项聚合值和子项缩进关系。
