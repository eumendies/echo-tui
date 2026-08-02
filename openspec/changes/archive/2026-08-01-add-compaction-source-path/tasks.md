## 1. 类型与 app 层路径解析

- [x] 1.1 在 `src/types/agent.ts` 的 `AgentSessionInput` 中新增可选 `sessionJournalPath` 字段，附带中文注释说明其为当前 session 的 transcript journal 文件绝对路径、headless 无 session 时缺省
- [x] 1.2 在 `src/app/state/transcript-context.ts` 新增 `getCurrentSessionJournalPath()`：`currentSessionId` 存在时调用 `transcriptStore.getSessionFilePath(getCurrentCwd(), currentSessionId)`，否则返回 `undefined`
- [x] 1.3 在 `src/app/state/app-context.ts` 的 `getAgentSession()` 中通过 `transcriptContext.getCurrentSessionJournalPath()` 计算并传入 `sessionJournalPath`

## 2. provider-facing 摘要注入

- [x] 2.1 修改 `src/agent/agent-loop-runtime.ts` 的 `buildProviderRecords`：新增可选 `sessionJournalPath` 参数，摘要消息存在且路径可用时附加 `source_file` 绝对路径行与按需 `read_files` 分页回读提示（措辞与 conversation-reference 一致，含 append-only 与 truncate 可失效说明）
- [x] 2.2 将运行时持有的 session 源路径传入 `buildProviderRecords` 调用点；headless 或路径缺失时保持仅摘要注入

## 3. 可见 notice 记录保持原文本

- [x] 3.1 确认 `compaction_notice` 属于 `NON_PROVIDER_ROLES`，只对用户可见、不进入 provider 请求，可见 notice 不需要携带路径
- [x] 3.2 保持 `createCompactionNoticeRecord` 单参数签名，输出「已将较早的 N 条历史压缩为摘要」既有文本；路径仅通过 `buildProviderRecords` 注入 provider-facing 摘要消息

## 4. 测试与验证

- [x] 4.1 更新 `context-compaction` 相关测试：`createCompactionNoticeRecord` 仅渲染被压缩条数
- [x] 4.2 更新 `agent-loop-runtime` 相关测试：`buildProviderRecords` 在路径可用时注入 `source_file` 与回读提示、路径缺失时不注入
- [x] 4.3 运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`
