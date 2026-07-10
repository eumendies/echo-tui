## 1. Session Todo State

- [x] 1.1 在 `src/types/transcript.ts` 定义 `TodoState` / `TodoItem`，并扩展 `TranscriptSession` 支持可选 `todoState`。
- [x] 1.2 在 `src/persistence/transcript-store.ts` 增加 `todoState` clone、shape 校验和旧 session 空状态回退。
- [x] 1.3 在 `TranscriptContext` 中持有 todo 状态，并接入 `persistCurrentSession`、`loadSession`、`clearRecords`。
- [x] 1.4 在 `AppContext` 中提供 todo 状态更新入口，并让 `getAgentSession()` 返回 todo 快照。

## 2. Todo Tools

- [x] 2.1 新增 todo 工具定义和参数解析，包含 `create_todos` 与 `complete_todo`。
- [x] 2.2 将 todo 工具加入默认 provider-visible tool registry，保持 schema 静态稳定。
- [x] 2.3 在 agent loop 中识别 todo 工具调用，解析参数、生成 next `todoState`、调用 app callback 持久化状态并返回 tool result。
- [x] 2.4 确保 todo 工具在 plan mode 下可执行，且不触发文件修改审批或工作区变更记录。

## 3. Provider Context Injection

- [x] 3.1 扩展 `AgentSessionInput` 和 agent loop state，携带当前 `todoState`。
- [x] 3.2 在 provider records 构造阶段追加未完成 todo transient user suffix。
- [x] 3.3 确保没有 open todo 时不追加 todo suffix，全部完成后后续请求不再注入。
- [x] 3.4 确保 todo suffix 不写入 transcript records、不写入 session `records`，且不改变 system prompt 文本。

## 4. Transcript And Compaction Behavior

- [x] 4.1 保持 todo tool call/result 按普通 tool transcript records 追加。
- [x] 4.2 验证 context compaction 可正常压缩 todo tool records，且未完成 todo 仍由 `todoState` suffix 注入。
- [x] 4.3 确认新建 todo list 覆盖旧 `todoState.items`，完成项不作为后续活跃状态继续注入。

## 5. Tool Message Rendering

- [x] 5.1 新增 todo tool message renderer，并在 `renderToolRecordLines` 中按 `create_todos` / `complete_todo` 路由。
- [x] 5.2 渲染 open todo 为未完成状态，并用主题颜色强调第一个 open todo。
- [x] 5.3 渲染 completed todo 为勾选状态，并对 todo 文本使用删除线。
- [x] 5.4 在 todo tool result 结构化 JSON 不可解析时降级到通用 tool result renderer。

## 6. Tests And Validation

- [x] 6.1 添加 transcript store 测试，覆盖保存、加载、旧 session 回退和 clone 隔离。
- [x] 6.2 添加 app context / transcript context 测试，覆盖 `/resume` 恢复、`/clear` 清空和 agent session 快照。
- [x] 6.3 添加 todo 工具解析和 agent loop 测试，覆盖创建、覆盖、完成、未知 id、plan mode 执行。
- [x] 6.4 添加 provider records 构造或 runtime 测试，覆盖 suffix 注入、不注入、不持久化和 system prompt 稳定。
- [x] 6.5 添加 render 测试，覆盖 create/complete todo 专属渲染、第一项 open todo 强调、completed 删除线和不可解析 fallback。
- [x] 6.6 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \\;`。
