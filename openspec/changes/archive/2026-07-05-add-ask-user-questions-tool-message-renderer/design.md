## Context

当前 transcript 渲染路径会先把相邻且 `toolCallId` 匹配的 `tool_call` / `tool_result` 聚合为 `tool_pair`，再交给 `renderToolPairBlock(call, result, width, theme)` 渲染。bash、todo、apply_patch 已经通过专用 renderer 避免把底层 payload 直接暴露给用户；未知工具则保留通用 fallback。

`ask_user_questions` 的成功 tool result 为紧凑 JSON，例如 `{"answers":[...]}`。该 JSON 面向模型续写，刻意不重复完整 question 文本和 option description；而 question 文本、选项和单选/多选声明已经存在于对应 `tool_call.argumentsText` 中。因此，渲染层可以使用现有 tool pair 分组同时读取 call 和 result，合成用户可读的回答回执。

## Goals / Non-Goals

**Goals:**

- 为 `ask_user_questions` 的相邻 tool call/result 对提供可读 transcript 投影，避免成功回答和取消结果直接显示原始 JSON。
- 显示题目文本、单选/多选模式、已选答案和 `Other` 自定义文本。
- 复用现有 tool message 视觉语言、宽度换行、截断和 theme token。
- 在解析失败、历史记录缺失或非相邻 tool pair 时安全回退到现有通用工具消息渲染。

**Non-Goals:**

- 不改变 `ask_user_questions` 的工具参数 schema、交互流程、取消语义或 tool result JSON。
- 不向 transcript result record 新增 `display` metadata，也不迁移既有 session 文件。
- 不为 transcript 中的回答回执绘制 footer 风格 card 或交互式界面。
- 不改变 provider adapter 如何接收 tool result，也不改变 agent loop continuation 行为。

## Decisions

### 使用 pair-aware renderer，而不是 result-only renderer 或 display metadata

在 `renderToolPairBlock` 中先进入 pair-aware 分支，用直接 `if` 判断当前是否是需要同时读取 call/result 的工具。`ask_user_questions` renderer 同时解析 `call.argumentsText` 中的问题定义和 `result.text` 中的回答结果，成功时返回完整 tool pair 的可见行；返回 `null` 时继续进入 split-render 分支，按既有单条 record renderer 分别渲染 call 和 result。

备选方案：

- result-only renderer：实现最简单，但无法显示 question 文本，只能展示“第 1 题：A/C”，可读性不足。
- result `display` metadata：可以恢复完整 UI 投影，但需要扩展 result metadata 并在执行层重复存储 question 数据；对当前需求过重。

选择 pair-aware renderer 的原因是项目已有相邻 tool pair 分组，问题和答案数据分别存在于 call/result 中，不需要改变协议或持久化 schema。pair-aware 与 split-render 两条路径在入口处显式分离，也方便后续新增其他必须同时读取 call/result 的工具投影。

### 仅解析已知成功和取消 JSON 形状

renderer 只识别两类 `result.text`：

- 成功：包含 `answers` 数组，answer 使用 `index` 关联 question；单选读取 `selected`，多选读取 `selectedOptions` 和 `multiSelect: true`。
- 取消：包含 `cancelled: true` 和可选 `reason`。

无效参数等失败结果当前可能是普通错误文本，这类结果继续由通用 fallback 显示，避免 renderer 猜测错误语义。任何 JSON 解析失败、字段类型不匹配、answer index 无法映射到 question 的情况都应触发 fallback，而不是抛错或输出半可信内容。

### 使用回答回执样式，而不是交互卡片

成功结果渲染为轻量 transcript receipt：

```text
◆ AskUserQuestions(2)
  ⎿ 1. Pick many?（多选）
       ● A
       ● C
    2. Pick one?（单选）
       ● No
```

取消结果渲染为：

```text
◆ AskUserQuestions(1)
  ⎿ 已取消：User cancelled ask_user_questions
```

这种形式与现有 tool call/result transcript 投影一致，表达“已经发生的事实”，不会与 footer 中正在等待输入的 choice surface 混淆。

### `Other` 自定义文本合并进答案行

当 answer 包含 `customText` 时，renderer 把自定义文本与对应选项 label 合并展示，例如 `● Other：custom answer`。这样用户不需要理解 `customText` 字段，也不会看到重复的 JSON 结构名。

### 测试以 renderer 单元测试为主

该变更是纯渲染投影变化，应优先覆盖 `renderToolPairBlock` 或等价公开 renderer seam。测试应验证：成功单选、多选、`Other`、取消、解析失败 fallback、call prefix 状态着色仍生效，以及窄宽度下不会抛错。

## Risks / Trade-offs

- [Risk] 历史 transcript 中 call/result 不相邻或缺少 `argumentsText`，renderer 无法恢复 question 文本。→ Mitigation：保留现有单 record / generic fallback。
- [Risk] provider 或旧版本产生非标准 answer JSON，专用 renderer 解析失败。→ Mitigation：解析器保持保守，只在完整匹配已知形状时启用专用投影。
- [Risk] 问题和答案很多时 transcript 过长。→ Mitigation：复用现有 tool result 显示截断策略，只影响可见投影，不修改原始 records。
- [Risk] 自定义文本较长或包含宽字符导致缩进错位。→ Mitigation：复用现有 display-width aware wrapping 和 `renderPrefixedLines` 辅助函数。

## Migration Plan

无需数据迁移。已持久化 session 在恢复时若包含相邻且可解析的 `ask_user_questions` tool pair，将自动使用新 renderer；不满足条件的历史记录继续显示为通用工具消息。回滚时移除专用 renderer 接入即可，transcript 事实内容和 tool result JSON 不受影响。

## Open Questions

无。
