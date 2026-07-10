## Context

当前 `apply_patch` handler 同时支持 unified diff 子集和 `*** Begin Patch` 格式。Begin Patch update 已被解析为顺序 chunk，并在模拟阶段通过 `searchStart` 表达“从当前位置继续定位”的语义；但实际定位仍调用 `findUniqueMatch()`，要求剩余文件中只出现一次目标序列。因此，当模型生成的 V4A 风格 patch 需要按顺序修改重复片段时，第一处匹配会因为后续还有同样片段而失败。

Codex/V4A 的常见 applicator 行为是维护一个搜索游标，并对每个 context、inline anchor 或 old-lines 序列选择游标之后的第一个匹配，然后推进游标。这更符合模型已学习的 V4A patch 语义，也能降低文档、测试和重复代码块编辑中的 false negative。

## Goals / Non-Goals

**Goals:**

- 让 Begin Patch update chunk 使用游标后的 first-match 定位规则。
- 让 `@@ <context>` inline anchor 和 context-only chunk 复用相同顺序游标语义。
- 保持 all-or-nothing 写入、路径安全、无锚点纯插入拒绝和 display metadata 行号可信。
- 通过测试覆盖重复上下文下的成功应用，防止回归到 multi-match 失败。

**Non-Goals:**

- 不改变 unified diff 的现有精确唯一匹配规则。
- 不实现 fuzzy matching、whitespace tolerant matching 或 hunk header 行号 tie-breaker。
- 不增加删除文件、移动文件或 mode/binary/symlink patch 支持。
- 不改变 `apply_patch` tool schema、授权流程或 provider-facing result 文本结构。

## Decisions

### Decision: 仅调整 Begin Patch sequential applicator

Begin Patch parser 已将 update 操作标记为 `matchMode: 'sequential'`，而 unified diff 使用 `matchMode: 'independent'`。本变更只在 `applySequentialUpdateHunks()` 中引入 first-match-after-cursor 定位，保留 independent 路径的 `findUniqueMatch()`。

备选方案是同时放宽 unified diff。该方案更一致，但当前 unified diff parser 不使用 hunk header 行号定位；直接改为 first match 可能让传统 diff 在重复块里误改第一处。因此先限定在 V4A/Begin Patch 路径。

### Decision: 新增明确的 first-match helper

实现上新增或等价提取 `findFirstMatch(lines, target, startIndex)`，只返回从 `startIndex` 开始扫描的第一个精确匹配，0 次匹配仍返回失败。`findUniqueMatch()` 保留给 independent update 和其他仍需唯一性的路径。

备选方案是给 `findUniqueMatch()` 增加参数控制是否允许多匹配。独立 helper 更直接，能让调用点清楚表达“唯一匹配”和“顺序首个匹配”两种不同语义。

### Decision: anchor 与 context-only chunk 都推进游标

当 chunk header 为 `@@ <context>` 时，handler 从当前游标后寻找第一条 anchor 行，并把游标推进到 anchor 后。context-only chunk 则从当前游标后寻找第一段 context old-lines，并把游标推进到该段之后。修改 chunk 匹配成功后，游标推进到替换后的 chunk 末尾。

备选方案是只放宽修改 chunk 的 old-lines 匹配，仍要求 anchor 唯一。这样会继续让重复函数名、重复 scenario 标题或重复 Markdown heading 触发 false negative，不符合 V4A 的逐步跳转模型。

## Risks / Trade-offs

- 重复片段中 patch 意图可能不是第一处 → 要求模型通过前置 context-only chunk 或更具体的 `@@ <context>` 先移动游标；测试覆盖顺序定位，文档提示仍鼓励提供足够上下文。
- Begin Patch 与 unified diff 行为不完全一致 → 在 spec 中明确区分两者；后续如需优化 unified diff，可单独设计 hunk 行号辅助定位。
- display metadata 行号可能因多处匹配变化而更重要 → 继续基于实际应用后的 `matchedHunks` 生成 metadata，并用测试断言实际文件内容和关键 postLine。
- 多个 hunk 应用后前序编辑会改变后续位置 → 继续在内存中的 `currentLines` 上顺序应用，并在每次应用后更新 `searchStart`。

## Migration Plan

该变更只影响本地工具运行时逻辑，无数据迁移。实现后运行 typecheck、完整测试和 JS 语法检查。若出现误改风险或测试回归，可回滚到唯一匹配 helper 调用；已有 transcript 和 change history 不需要迁移。

## Open Questions

无。unified diff 是否引入 hunk header 行号 tie-breaker 留作后续独立优化。
