## Context

当前 `AppContext.interactionMode` 同时驱动 footer、agent session 和工具风险分类。agent runtime 在每次 provider 请求中根据 mode 动态追加 Plan Mode user suffix；该 suffix 不进入 transcript。切回 normal 后 suffix 消失，但上一轮 assistant 写入 transcript 的“当前是 Plan Mode”仍会继续发送给模型，模型可能把自己的历史结论误认为仍有效的系统约束。

user transcript record 已支持两份文本：`text` 面向 provider 和持久化，`displayText` 面向终端渲染；direct skill invocation 和内置 agent workflow 已使用该机制隐藏展开后的内部 prompt，同时通过 `historyText` 保持 composer 历史为用户原始输入。本变更复用同一模式，不增加新的 transcript role。

## Goals / Non-Goals

**Goals:**

- 把 normal/plan 模式切换表达为持久化、模型可见的 user message 内容。
- 只在模型可见 mode 相对上一条 agent user message 发生变化时注入一次，不在同一 mode 的每轮请求重复注入。
- 进入 plan 和退出 plan 都提供明确且方向相反的说明，避免单向 Plan Mode 状态残留。
- UI transcript 和输入历史继续显示用户原文，不展示内部 mode prompt。
- 删除 plan 动态 suffix，同时保持 todo 动态 suffix、工具风控和审批边界不变。

**Non-Goals:**

- 不改变 normal、plan、shell、shell-local 的 Tab 和 `/mode` 交互。
- 不把 shell/shell-local 命令改造成 agent user message。
- 不依赖 mode prompt 作为写操作安全边界，也不放宽 plan mode 的 runtime 拒绝策略。
- 不为 mode transition 新增独立可见 transcript block 或配置持久化字段。
- 不改变 todo runtime context 的动态 suffix 语义。

## Decisions

### 在发生模型可见切换的下一条 user record 中携带 mode prompt

提交 agent turn 时，系统比较当前 mode 与上一条已提交给 agent 的 normal/plan mode。若两者不同，构造以下 provider-facing user text：

```text
[Interaction Mode Transition]
from: <previous>
to: <current>

[Mode Instructions]
<current mode instructions>

[User Request]
<expanded user request>
```

进入 plan 的说明要求只读讨论和检查，并要求不得修改文件、运行变更命令或使用受限工具；进入 normal 的说明明确此前 Plan Mode 限制已解除，允许在正常工具审批规则内实施修改。

选择 user record 而不是 system prompt 或 runtime suffix，是因为 mode 切换属于对话中需要持续生效的事件。该 record 会随 transcript 持久化和 resume 恢复，后续请求无需重复生成同一说明。

### 区分 provider-facing text、displayText 和 historyText

发生切换时：

- `text` 保存 mode transition、mode instructions 和已完成文件 mention 展开的用户请求；
- `displayText` 保存用户提交时希望在 transcript 中看到的原文；
- `historyText` 继续保存 composer 的原始输入；
- `interactionMode` 继续记录该 user turn 的提交 mode；
- 可增加结构化 `modeTransition` metadata，记录 `from`、`to`，供测试、恢复和后续状态重建使用，而不要求通过解析 prompt 文本判断切换。

未发生切换时沿用现有普通 user record 行为，不写 `modeTransition`，也不制造额外隐藏文本。渲染继续优先读取 `displayText`，因此 resize、resume 和普通重绘都只展示用户原文。

### 跟踪上一条模型可见 mode，而不是最后一次 UI 切换动作

App 状态维护 `lastSubmittedAgentMode: 'normal' | 'plan'`。默认基线为 normal；只有真正创建 agent user record 时才更新。这样：

```text
normal → plan → normal → 提交
```

不会产生无意义的 transition，因为模型没有看到中间的 plan。shell/shell-local 命令不更新该状态；从 shell 返回后，下一条 agent user message 仍与最后一次模型可见的 normal/plan mode 比较。

加载 session 时从最后一条带有效 `interactionMode` 的 agent user record 恢复该状态；没有可用元数据时回退到 normal。清空 transcript 后恢复 normal 基线；undo 若截断最后一条 agent user record，则从剩余 records 重新计算。状态本身仍是 app 运行态，权威历史由 user records 的 metadata 提供。

### mode prompt 不再进入 runtime context suffix

`buildProviderRecords` 仍构造稳定 system prefix、压缩摘要、活跃 transcript 和 runtime suffix，但 runtime suffix 只承载当前 todo 状态。interaction mode 仍传入 agent loop，用于工具风险分类、usage、debug 和 hook payload，不再用于构造 mode suffix。

这种拆分让两类状态采用不同生命周期：

- mode transition 是低频、需要持久化的对话事件；
- todo 是高频、只表达当前 open items 的运行态快照。

### compaction 沿用普通 user record 语义

mode transition record 按普通 user record 参与 token 估算、摘要和活跃区间投影，不增加固定 pin 或额外动态 mode suffix。若 transition 已进入压缩区间，其语义由现有结构化摘要机制承载；无论摘要质量如何，plan 写操作安全仍由 tool risk classifier 独立保证。

这是对“只在 mode 切换消息中注入”的直接贯彻，避免为 compaction 再引入第二套 mode prompt 通道。

## Risks / Trade-offs

- [Risk] mode transition 被压缩后，摘要模型可能弱化当前 plan 的行为说明。→ plan 工具风险分类继续作为硬边界；mode transition 文本按普通关键用户指令参与摘要，不新增重复 suffix。
- [Risk] 只记录 UI 切换动作会在多次切换但未提交时产生错误 transition。→ 比较 `lastSubmittedAgentMode` 与当前 agent mode，仅在创建 user record 时更新。
- [Risk] resume、clear 或 undo 后运行态与 transcript 尾部不一致。→ 从剩余 user records 的 `interactionMode` metadata 重建；无记录时使用 normal 基线。
- [Risk] 内部 mode prompt 可能在复制、导出或直接读取 session JSON 时可见。→ 这是 provider-facing transcript 的预期内容；终端渲染和输入历史只使用 `displayText` / `historyText`，行为与 direct skill invocation 一致。
- [Risk] user-role mode prompt 可被后续用户文本挑战。→ 它只负责模型行为引导，写入安全仍由 runtime tool classifier 保证。

## Migration Plan

无需迁移已有 session schema。旧 user records 没有 `modeTransition` 时仍可按现有方式读取；`interactionMode` 缺失时按 normal 基线处理。上线后新发生的 normal/plan 切换开始生成隐藏 transition 内容。

回滚时可恢复 agent runtime 的 plan suffix 构造并停止包装新 user message；已持久化的 transition records 仍是合法 user records，不影响 session 解析。

## Open Questions

无。
