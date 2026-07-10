## Context

当前 agent loop 每次请求会构造 transient provider records：稳定 system prompt、可选 compaction summary、当前活跃 transcript records，以及 plan mode 的 transient user suffix。上下文压缩只作用于 transcript records，并用模型生成的摘要保留较早历史；摘要中的 todo 小节不是可靠状态源。

todo 管理的目标不同于普通对话历史：未完成 todo 是后续请求必须看到的当前会话事实，但 todo 更新频率较高，不能写入 system prompt 或 AGENTS 指令，否则会让 prompt cache 的稳定前缀频繁变化。它也不应依赖普通 tool history，因为历史可以被压缩，且压缩摘要可能改写或遗漏细节。

## Goals / Non-Goals

**Goals:**

- 提供模型可调用的 create todos 和 complete todo 工具。
- 用会话级结构化 `todoState` 保存当前 todo list，随 transcript session 持久化、恢复和清空。
- 每次 provider 请求只把未完成 todo 注入为末尾 transient user suffix；全部完成时不注入 todo suffix。
- 新建 todo list 时覆盖旧的运行时 todo list，旧的完成项不继续保留为活跃状态。
- 保持 system prompt、AGENTS、skill catalog 和 provider-visible tools schema 的缓存稳定性。
- 让 todo tool call/result 继续作为普通 transcript records 进入现有渲染、持久化和压缩流程。
- 为 todo tool call/result 提供专属终端消息渲染，让用户能快速识别当前 todo 完成状态。

**Non-Goals:**

- 不新增面向用户的 `/todo` slash command 或独立 todo UI。
- 不把 todo 写入项目文件，例如 `TODO.md`。
- 不长期保存已完成 todo 的审计日志；审计信息由普通 transcript/tool history 承担。
- 不改变现有 context compaction 的边界算法或摘要生成模板。
- 不引入第三方依赖或外部存储。

## Decisions

### 1. `todoState` 归属于 `TranscriptContext`

`todoState` 是当前 transcript session 的结构化事实状态，应和 `records`、`compaction`、`changeHistory` 处于同一生命周期。`TranscriptContext` 负责 load/save/clear 当前 session，因此新增 `todoState` 字段和更新方法最符合现有边界。

替代方案：放在 `TurnContext`。该方案只能覆盖单轮响应，无法自然支持 `/resume`。放在 `RenderContext` 则会把 provider 语义状态混入 UI 状态。放在 agent loop 本地状态会让持久化和 app 生命周期反向依赖 runtime。

### 2. session JSON 顶层持久化 `todoState`

持久化结构放在 `TranscriptSession` 顶层：

```json
{
  "records": [],
  "compaction": {},
  "changeHistory": [],
  "todoState": {
    "items": [
      {
        "id": "todo_1",
        "text": "实现 todo suffix 注入",
        "status": "open"
      }
    ],
    "updatedAt": "2026-06-30T00:00:00.000Z"
  }
}
```

`todoState.items` 只代表当前运行时 todo list。创建新的 todo list 时整体替换 `items`；完成后状态可以短暂保留为 `completed`，但当全部完成或下一次创建列表时，不再需要为了 provider suffix 保留旧完成项。持久化层负责 clone 和 shape 校验；无效或缺失状态回退为空列表。

替代方案：把 todo 作为特殊 transcript record 保存。该方案会被压缩边界和摘要语义影响，且会把当前事实状态分散在历史中。

### 3. agent session 携带 todo 快照，provider records 末尾注入 suffix

`AppContext.getAgentSession()` 从 `TranscriptContext` 读取 `todoState` 快照并传给 agent loop。`buildProviderRecords` 在稳定前缀和 active transcript records 之后追加 transient todo suffix，仅当存在未完成 todo 时追加。

suffix 文案应明确这是当前会话状态，未完成前必须持续跟踪，并包含稳定 id：

```text
# Active Todos

These unfinished todo items are current session state and remain active until completed:
- [todo_1] 实现 todo suffix 注入
- [todo_2] 增加持久化测试
```

若当前没有未完成 todo，则不追加 todo suffix。plan mode suffix 与 todo suffix 都是 transient user records；为了保持行为稳定，todo suffix 应在 active transcript 之后追加，plan mode 约束仍保持最后或采用固定顺序，确保 mode 约束不会被 todo 文本稀释。

替代方案：把 todo 注入 system prompt。该方案约束更强，但每次 todo 改变都会破坏 system prompt 缓存前缀。

### 4. todo 工具作为 agent loop 的状态型工具处理

新增 provider-visible 工具：

- `create_todos`: 接收 `items[]`，创建新的当前 todo list，并覆盖旧 `todoState.items`。
- `complete_todo`: 接收 `ids[]`，将匹配 todo 标记为 completed。

两者不修改文件或系统状态，不需要用户审批；在 plan mode 下仍可执行，因为 todo 是 assistant 会话状态，不是工作区变更。agent loop 应像处理 `ask_user_questions` 一样在普通 executor 前识别 todo 工具：解析 arguments、计算 next `todoState`、通过 callback 交给 app 持久化，然后返回 tool result。

tool result 应返回当前未完成 todo 列表和操作结果。tool call/result 本身仍追加到 transcript，并由现有 compaction 处理；后续请求的权威 todo 来源始终是 `todoState` suffix。

替代方案：通过普通 `ToolHandler.execute()` 直接更新状态。当前 `ToolExecutor` 只持有 registry handler 和执行选项，不拥有 `AppContext`，强行把 app 状态塞入 executor 会扩大工具层职责。

### 5. clear、resume 和 undo 的状态边界

`/resume` 加载 session 时恢复 `todoState`。`/clear` 清空 transcript 时同步清空 `todoState`。`/undo` 当前只回退文件变更和 transcript/compaction 边界；todo 工具不改文件，且 todo 状态是 assistant 会话运行状态，本变更不要求 `/undo` 回退 todoState。

若未来需要完整时间旅行，可让 change checkpoint 捕获 todoState before/after；本次不引入该复杂度。

### 6. todo 工具使用专属 tool message renderer

todo tool result 应返回 renderer 可解析的结构化 JSON，至少包含当前 todo 列表、已完成 id 和未找到 id。渲染层在 `tool-message-renderer` 中按 `toolName` 路由到 todo renderer；若结构化结果无法解析，则降级为通用 tool result 渲染，保证历史兼容。

todo renderer 的显示规则：

- completed todo 显示勾选符号，并对 todo 文本使用删除线。
- open todo 显示未完成符号。
- 当前列表中的第一个 open todo 使用主题中的强调/工作色标记，帮助用户快速看到下一项。
- `create_todos` 和 `complete_todo` 都显示操作后的当前列表，而不是只显示原始 JSON。

替代方案：复用通用 tool result 渲染。该方案实现最少，但用户看到的是 JSON，不利于高频 todo 状态快速扫描。

## Risks / Trade-offs

- [todo suffix 是 user record，约束强度低于 system] → 内置 system prompt 已要求遵守当前 runtime/tool policy；todo 工具返回结果和每次 suffix 都重复当前未完成事实。
- [模型频繁重建 todo list 导致尾部变化] → 变化仅发生在 provider records 末尾，不改写 system prompt 或 tools schema；这是必要的当前状态更新。
- [完成项不长期保留导致缺少历史审计] → 普通 transcript 中仍保存 create/complete tool call/result，完成项不作为活跃运行时状态保留。
- [todo 工具历史压缩后丢失操作细节] → 这是可接受的历史压缩行为；未完成 todo 的权威状态来自 `todoState`。
- [plan mode 下 todo 工具可执行可能被误解为修改] → 工具说明和 risk classifier 应明确 todo 工具只修改会话内 assistant 计划状态，不修改文件或系统状态。
- [删除线或强调色在部分终端主题下可读性不佳] → renderer SHALL 保留文本本身和状态符号，颜色/删除线只作为增强表现。

## Migration Plan

1. 扩展 transcript/session 类型与 persistence clone/validate，使缺失 `todoState` 的旧 session 自动回退为空状态。
2. 在 `TranscriptContext` 增加 todo 状态读写、load/save/clear 集成。
3. 扩展 `AgentSessionInput` 和 `AppContext.getAgentSession()`，把 todo 快照传入 agent loop。
4. 新增 todo 工具定义、参数解析和 agent loop 状态更新 callback。
5. 在 provider records 构造阶段追加未完成 todo suffix，并保持无未完成项时不追加。
6. 增加 todo tool message renderer，并接入 tool renderer 路由。
7. 增加测试覆盖持久化、resume/clear、工具状态更新、suffix 注入、全部完成后不注入、plan mode 可执行语义和 todo renderer 输出。

Rollback 策略：若发现模型行为异常，可先从默认 registry 移除 todo 工具并忽略 `todoState` suffix；已持久化的 `todoState` 字段可保留为向前兼容的 session metadata。

## Open Questions

- todo id 由 runtime 生成还是允许模型传入稳定 id？建议由 runtime 生成，避免重复和非法 id。
- `complete_todo` 对未知 id 应部分成功还是整体失败？建议返回 structured result，标明 completed 和 notFound，允许部分成功。
