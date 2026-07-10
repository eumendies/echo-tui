## Context

当前 `apply_patch` handler 在解析 patch 后立即生成 display-only metadata，其中只保存文件、hunk 以及 `context` / `removed` / `added` 文本行。随后内存模拟阶段才通过精确唯一匹配获得实际位置，因此现有 metadata 无法提供可信行号，也无法包含 patch 参数之外的文件上下文。

渲染层目前会扁平化所有文件和 hunk，按最长增删文本补背景，并在超过固定预算后从尾部截断。该方式无法清晰表达多文件边界，短增删行的背景不完整，后续 hunk 也容易被完全隐藏。历史恢复又要求只使用持久化 metadata，不能在 renderer 中重新读取当前文件。

## Goals / Non-Goals

**Goals:**

- 使用文件和 hunk 层级保留实际编辑结构。
- 为成功定位的修改提供基于修改后文件的可信单列位置提示。
- 使用 `+` / `-` 替代增删行的可见行号，同时保持正确的修改后行号推进语义。
- 让 handler 提供完整事实行序列，由 renderer 为每个修改区块保留前后上下文并折叠较长未修改区间。
- 让增删背景覆盖定位 gutter、分隔符和内容区至终端安全右边界。
- 在软显示预算内公平保留各文件和修改区块的关键信息；最低结构超过预算时允许溢出。
- 保持 patch 执行语义和 provider-facing result text 不变。

**Non-Goals:**

- 不实现字符级或词级 diff 高亮。
- 不引入交互式展开、折叠或滚动控件。
- 不信任 unified diff header 中由模型提供的行号来定位文件。
- 不在恢复历史或普通渲染期间读取目标文件。
- 不修改 apply-patch 支持的 patch 语法、风险分类或授权流程。

## Decisions

### 1. 在内存模拟阶段生成已定位的 display metadata

update hunk 继续使用 `oldLines` 做精确唯一匹配。匹配成功后，handler 使用实际 match index 生成 display hunk，记录修改后文件位置和修改前文件中的有限周边上下文；同一文件的后续 hunk 基于前一 hunk 已应用后的内存内容继续定位。

每个 display file 必须包含：

- 覆盖完整 post-image 文件的有序 `context` / `added` 行。
- 插入在对应修改位置的 `removed` 行。
- 每条仍存在于 post-image 的行对应的真实行号；removed 和 unresolved 行使用 `null`。

新增文件从修改后文件第 1 行开始推进。匹配失败时保留解析得到的尝试编辑内容，但不得使用 patch header 行号伪造实际位置，也不得补充无法确认的目标文件上下文。

选择在 handler 中生成，而不是在 renderer 中重新解析 patch 或读取文件，是为了让实时显示和 `/resume` 使用同一份事实快照。

### 2. 使用单列 post-image 定位 gutter

可见 gutter 只有一列，语义以修改后文件为准：

```text
  118 │ context
    - │ removed
    + │ added
  120 │ next context
```

- `context` 显示其修改后文件真实行号并推进一行。
- `added` 显示 `+`，隐藏其真实行号，但仍占用并推进一个修改后文件行号。
- `removed` 显示 `-`，因为该行不存在于修改后文件，所以不推进修改后文件行号。
- wrapped continuation 不显示定位值，也不推进逻辑行号。
- omitted marker 显示 `…`，后续 context 使用省略区间之后的真实行号。

相比 old/new 双行号，该方案更适合窄终端；相比完全不记录行号，它仍能让用户确认修改所在位置。metadata 可以保留 renderer 推导正确 post-image 行号所需的信息，但 UI 不展示双行号。

### 3. 每个修改区块保留前后各 3 行上下文

handler 返回完整文件事实行。renderer 根据 added/removed 行识别修改区块，为每个区块保留前后各 3 行 context；重叠或相接窗口合并成一个窗口。

超过保留窗口的未修改区间投影为：

```text
    … │ … 18 unchanged lines …
```

省略数量由 renderer 根据完整 context run 精确计算。相邻省略区间必须合并，任何两个 omitted rows 不得连续出现。新增文件没有未修改 context，直接展示新增内容。

3 行是在定位能力和 transcript 高度之间的默认平衡；本次不增加用户配置项。

### 4. 文件分组和统计属于 display projection

renderer 为每个文件输出路径标题和 `+N -N` 统计，并在文件下按 hunk 或合并后的修改窗口展示行。统计只计算 added/removed 逻辑行，不计算 context、wrapped continuation 或 omitted marker。

成功 result 隐藏原有 `Applied patch` 文本摘要；失败 result 仍先显示简洁失败原因，再显示可用的尝试编辑结构。

### 5. 增删背景使用当前物理行的全部可用内容宽度

增删样式从定位 gutter 开始，包含分隔符、内容和右侧 padding，一直延伸到 `safeRenderWidth(width)`。外层 `⎿` 工具前缀及其缩进保持中性。

长逻辑行换行后，每个 continuation 物理行继续使用相同背景并补齐至安全右边界。所有宽度和 padding 继续通过 grapheme-aware `displayWidth()` 计算，避免中文、emoji 和 ANSI 序列破坏对齐。

### 6. 截断以结构为单位进行

renderer 先执行修改区块间的上下文折叠，再应用 apply-patch 专用软预算。预算不足时：

1. 保留每个文件标题。
2. 保留每个 hunk 至少一个包含实际增删行的窗口。
3. 优先省略未修改 context，其次从过长修改窗口的中间省略。
4. 使用带数量的 marker 表明省略了多少逻辑行。

当文件标题、失败原因和每个修改区块至少一行的最低结构已经超过预算时，renderer 允许投影超过预算，不再做无语义尾部切片。这替代当前“保留前 N 行并丢弃全部尾部”的策略，避免后续文件或修改区块完全不可见。截断只影响可见投影，不修改 transcript metadata 或 provider-facing result。

### 7. metadata 不使用版本字段

`kind: 'apply_patch'` 和完整结构校验已经足以识别专属 metadata。实现不增加 `schemaVersion` 或其他只为假设中的旧结构服务的分支。缺少有效 metadata 的解析失败结果使用通用 tool result 渲染。

## Risks / Trade-offs

- [display metadata 体积增加] → 文件本身已有 1 MB 上限且 metadata 不进入 provider input；完整事实快照换取单一、可复现的 renderer 折叠逻辑。
- [多 hunk 顺序应用导致行号计算复杂] → 在现有内存模拟循环中随实际内容变更同步生成位置，不从原始 patch header 推导。
- [写盘失败时 metadata 已描述内存模拟结果] → 失败原因明确显示；metadata 表示“尝试编辑内容”，不会宣称文件已成功写入。
- [极窄终端中 gutter 和内容空间不足] → gutter 宽度按当前文件最大可见行号计算，并复用现有安全换行；必要时内容至少保留一列。
- [结构化截断算法增加 renderer 复杂度] → 先构造纯逻辑 display rows，再独立完成预算分配和 ANSI 渲染，分别测试。

## Migration Plan

1. 用完整文件行序列替换 hunk 级窗口和省略字段，不增加 metadata 版本字段。
2. 将 metadata 生成移动到内存模拟阶段；匹配失败时保留 postLine 为 `null` 的尝试编辑内容。
3. 更新 renderer 独立完成修改区块识别、上下文折叠、单列 gutter、整行背景和结构化截断。
4. 更新自动化测试与架构文档。
5. provider-facing transcript 内容保持不变。

## Open Questions

无。默认上下文窗口固定为修改前后各 3 行，apply-patch 专用预算为软预算。
