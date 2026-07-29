## Context

当前 transcript 已按 cwd 分区持久化为单 session 单 JSONL journal，`/resume` 能列出和预览历史会话，`TranscriptStore.loadSession` 能 replay journal 得到最终有效 records。composer 已有文件附件式上下文展开先例：可见文本与 provider-facing `text` 分离，后者携带展开内容。

本变更把一次历史会话作为单个 composer 附件。用户只选择会话，不选择消息；系统在选择后准备一份不可变引用投影。短会话投影最终有效历史全文，长会话调用当前模型生成结构化总结。两种投影都只向模型附带源 journal 绝对路径，不额外暴露 session id、更新时间等内部字段。模型需要总结之外的细节时使用已有 `read_files` 读取该路径，不注册新工具。

实现必须遵守现有 CommonJS TypeScript 构建、ANSI/footer 渲染、非 alternate-screen 终端和 append-only transcript 约束。

## Goals / Non-Goals

**Goals:**

- 提供显式、会话级的历史引用选择，不要求用户逐条勾选消息。
- 将被引用会话 replay 后的最终有效状态投影为中立文本，避免把跨 session 的工具协议记录和 provider-private records 直接拼入当前 transcript。
- 按模型上下文预算稳定地区分短会话全量投影与长会话结构化总结。
- 让模型获得源 journal 路径，并可通过现有 `read_files` 按需读取原始记录。
- 保持可见引用简洁、提交结果可重放、临时状态可取消且不污染源会话。

**Non-Goals:**

- 不支持逐消息或任意区间选择。
- 不自动搜索、猜测或选择用户可能想引用的历史会话。
- 不新增 `read_conversation_session` 或其他专用会话读取工具。
- 不为 journal 生成额外 Markdown/JSON 快照文件，也不实现引用总结缓存。
- 不把引用变成 `/resume`、分支或源 session 的继续写入。
- 首版每条草稿只附加一个历史会话，不支持多个会话叠加。

## Decisions

### 1. 使用 `/reference` 打开单会话选择器

新增 `/reference` 命令，复用 `/resume` 的历史 session 列表与预览交互，但确认行为是创建 composer 附件而非替换当前 transcript。列表排除当前持久化 session，按更新时间倒序排列；每项以第一条有效 user `displayText`（回退 `text`）生成有界标题，并保留时间作为选择器辅助信息。确认后关闭 surface，composer 显示一个独立引用卡片，用户再输入当前请求。

选择器不提供消息焦点、多选或消息勾选。若已有 pending 引用，再次确认会替换旧引用。选择器命令而不是新字符触发器，可以避免 `#` 与 Markdown 输入、`@` 与现有文件 picker 发生冲突；未来可在不改变引用状态模型的前提下补充快捷入口。

### 2. 独立 ConversationReferenceContext 持有草稿附件

引用附件不编码进 composer 字符数组，而由独立 transient context 持有：

```ts
type PendingConversationReference = {
  sourceSessionId: string;
  sourcePath: string;
  title: string;
  projectionMode: 'full' | 'summary';
  projectionText: string;
};
```

`sourceSessionId` 仅供本地加载和内部 metadata 使用；引用卡片与 provider-facing 引用正文不输出该字段。独立 context 避免全文破坏光标、输入历史和 composer 编辑模型，也让提交、取消、`/clear`、`/resume` 的清理边界明确。

### 3. 从 replay 后的 session 构造中立引用正文

系统通过 transcript store 加载并 replay 用户选中的 journal，再从最终 `session.records` 构造引用材料。被 `truncate_records` 移除的记录自然不会进入投影。投影保留 provider 可能需要的 user、assistant、system、可进入上下文的 shell 以及有界工具调用/结果文本；过滤 local notice、error、compaction notice、reasoning summary 和 provider-private extension。

所有保留记录都转换为带角色标签的纯文本，不把历史 `tool_call`/`tool_result` 对象或 reasoning extension 直接合并进当前 records。这样不会产生跨 session tool call ID 冲突、孤立工具结果或 provider 协议不合法的问题。

### 4. 使用独立引用预算决定 full 或 summary

先对中立引用正文使用现有 token estimator 估算。引用预算采用：

```text
max(2_000, min(12_000, floor(contextWindow * 0.10)))
```

估算不超过预算时使用 `full`；超过预算时使用 `summary`。该预算独立于当前 session 的自动 compaction 阈值，目的是限制单个外部会话附件占用，而不是决定当前 session 是否压缩。

长会话摘要复用当前生效 provider agent 和 compaction 的无工具摘要调用约束，但使用独立提示词，要求输出背景与目标、关键决定、重要事实、文件与符号、未决事项和按主题组织的会话脉络。摘要调用不携带工具定义、普通 reasoning 参数，不修改源 session 的 compaction，也不写回源 journal。

不直接把源 session 的现有 compaction summary 当作最终引用总结。引用读取已经 replay 出完整最终 records，因此摘要输入只使用一次中立化后的最终 records；不再额外拼接 compaction summary，避免同一段历史重复进入摘要上下文。

### 5. 只在引用正文中输出标题、投影内容和 source_file

模型可见格式保持最小化：

```text
<referenced_conversation mode="summary">
title: MCP 工具授权设计
source_file: /absolute/path/to/session.jsonl

...全量对话或结构化总结...
</referenced_conversation>

<current_request>
...用户当前输入...
</current_request>
```

引用正文不单列 session id、createdAt、updatedAt、消息数等 metadata。`source_file` 的文件名可能天然包含 session 标识，这是现有 journal 路径的一部分，不再重复输出。正文同时说明引用内容是历史上下文而非当前指令；summary 模式提示模型仅在需要精确细节时使用已有 `read_files` 分页读取 `source_file`。

不创建专用读取工具。接受原文件是 append-only journal 的事实，并在引用提示中简要说明后续 truncate/set 操作可能覆盖前序状态；通常回答优先依赖系统已生成的最终状态总结，原 journal 只作为细节回查来源。

### 6. 提交时固化投影并保持可见文本简洁

确认选择时 pending attachment 保存中立引用材料和预算分类，不发起 provider 请求。下一次普通 user submit 才固化 `projectionText`：短会话直接使用全文，长会话先生成结构化总结，再与当前请求组合为 provider-facing `text`。`displayText` 保持用户原始请求；`UserTranscriptMetadata` 保存引用标题、源路径、内部 source session 标识和最终投影模式，供 replay 后渲染引用卡片。

实际全量正文或总结已经包含在该 user record 的 `text` 中，因此源 journal 后续追加不会改变当前 transcript 当时发送给模型的内容。提交成功后清空 pending reference；后续 turn 通过当前 transcript 自然继承引用，不重复展开附件。

### 7. 引用准备沿用可取消的响应锁

确认选择时只加载所选 journal 并设置 pending attachment。长会话在用户发送当前请求后才进入 `preparing reference` 状态并发起摘要请求；该状态阻止重复提交和其他会话切换，显示 spinner，允许 Esc 通过 AbortController 取消。取消或摘要失败时不追加 user/assistant transcript、不修改源 session，并保留 pending attachment 和 composer 请求供重试；成功后才固化投影并开始普通 assistant turn。

引用为空、journal 无法 replay 或摘要返回空文本时视为准备失败，并在 footer 给出可关闭反馈。

## Risks / Trade-offs

- [Risk] 模型通过 `read_files` 看到的是 journal 操作而非物化快照，可能误读被 truncate 的旧记录 → 在引用提示中标明 journal 语义，默认依赖 replay 后生成的全文/总结；仅把原文件作为精确细节回查来源，不宣称它是最终状态快照。
- [Risk] 发送带长会话引用的消息会额外产生一次模型请求和等待 → 仅在引用正文超过独立预算时触发，展示 spinner 并支持 Esc 取消；首版不增加缓存复杂度。
- [Risk] 全量投影仍可能与当前 session、system prompt、工具 schema 共同触发自动 compaction → 使用保守的独立引用预算；最终请求继续经过现有整体 compaction 检查。
- [Risk] 历史文本包含旧指令或提示注入内容 → 使用明确边界和历史上下文说明，要求模型只把当前请求视为本轮指令。
- [Risk] source journal 在引用后被其他进程继续追加，按需读取可能看到比引用时更新的内容 → 已提交的正文保持不可变；路径仅用于补充读取，首版不为路径创建快照。
- [Trade-off] `/reference` 比字符快捷入口多一次命令提交，但不会侵入 Markdown 或文件 mention 输入；未来可增加快捷入口而无需改变投影和持久化语义。

## Migration Plan

本变更只增加可选 user metadata 和 transient state，旧 journal 不需要迁移。旧 user records 缺少引用 metadata 时按普通消息渲染。若需回滚，可移除 `/reference` 入口和引用渲染；已写入 journal 的可选 metadata 由现有兼容读取逻辑保留或忽略，user `text` 仍是合法普通文本。

## Open Questions

无。首版固定为单 pending 引用、`/reference` 入口、上述引用预算和无专用读取工具。
