## Context

当前本地工具执行链路由 OpenAI adapter 暴露 tool definitions，agent loop 收到 tool call 后通过 provider-neutral executor 执行 handler，并把 tool result 继续发送给模型。`apply_patch` 授权已经证明了 agent loop 可以在工具执行前暂停，并通过 app 层 choice surface 等待用户决策。

`ask_user_questions` 与普通工具不同：它的结果不是来自文件系统、shell 或网络，而是来自用户在 TUI 中的选择。因此它应被建模为 interactive tool：仍作为 function tool 暴露给模型，但执行时不进入普通 executor handler，而是在 agent loop 中交给 app 层交互上下文处理。

## Goals / Non-Goals

**Goals:**

- 暴露 `ask_user_questions` 工具，让模型在缺少必要用户决策时发起结构化提问。
- 第一版支持一个 tool call 包含多个问题，并逐题显示，避免一次堆叠成问卷。
- 复用现有 `choice` surface 显示问题标题、选项和 option description。
- 在 agent loop 中暂停当前工具 continuation，等用户选择后生成 tool result 再继续。
- Esc 取消 SHALL 作为失败 tool result 回传模型，而不是 app 本地错误。

**Non-Goals:**

- 第一版不支持多选、Other、自定义文本输入或开放问题。
- 第一版不为 `ask_user_questions` 增加专属 transcript renderer；可复用现有 generic tool call/result 展示。
- 不改变普通工具 executor 的 handler 契约，不把 UI 交互塞进普通 ToolHandler。
- 不改变 choice surface 的基础视觉设计。

## Decisions

### 将 `ask_user_questions` 设计为 interactive tool

`ask_user_questions` SHALL 暴露为普通 function tool definition，但 agent loop 在收到该 tool call 时 SHALL 识别它为 interactive tool，并调用新的 app callback 等待用户回答。这样既能让 provider 看到工具 schema，也避免普通 tool executor 持有 TUI 输入状态。

替代方案：实现成普通 ToolHandler。该方案会让 handler 需要访问 app UI 或 stdin 状态，破坏现有 provider-neutral executor 的职责边界。

### 新增 `UserQuestionContext` 管理 UI 状态

App 层新增 `UserQuestionContext`，职责类似 `ToolApprovalContext`：持有 active request、当前题目索引、当前选项索引、已选答案、Promise resolve；通过 `getSurface()` 投影为 `ChoiceCommandSurface`，通过 `handleEvent()` 消费输入。

surface 优先级建议为：`UserQuestionContext` → `ToolApprovalContext` → command runtime。用户问题是当前 agent turn 的阻塞点，应优先消费输入，避免污染 composer 或 slash command。

### 第一版只支持逐题单选

参数允许 `questions[]`，但每个 question 必须有非空 options；工具语义固定为逐题单选，不暴露多选配置。逐题显示比一次渲染所有问题更稳定，也更符合 choice surface 的低信息密度目标。

### 返回 JSON tool result

用户完成所有问题后，tool result 的 `text` SHALL 是 JSON 字符串，包含每题 question 文本和选中的 option label/description。用户 Esc 取消时，返回 `ok: false`，text 为 JSON 字符串，包含 `cancelled: true` 和 reason。这样模型能区分用户取消和系统故障。

### 参数解析与 result 构造放入工具模块

新增 `ask-user-questions-tool-handler` 模块负责 tool definition、参数 parser 和 result builder。虽然交互执行不走普通 executor，但 schema 与解析规则仍属于工具边界，集中在工具模块可减少 agent loop 和 app context 的重复逻辑。

## Risks / Trade-offs

- [Risk] 模型滥用提问工具导致频繁打断用户 → 工具 description 明确要求只在答案必要且无法从上下文推断时使用，并限制问题和选项数量。
- [Risk] 第一版不支持 Other/开放文本导致表达不足 → 用户可 Esc 取消；后续可在 choice surface 基础上增加文本输入子状态。
- [Risk] 多问题 tool call 过长影响 UI → 逐题显示，并限制问题数量和每题选项数量。
- [Risk] interactive tool 分支增加 agent loop 特例 → 第一版只为 `ask_user_questions` 增加小型识别函数；等第二个 interactive tool 出现再抽象 registry。
