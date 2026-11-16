## 1. 类型与持久化 store

- [x] 1.1 新增 `src/types/session-approvals.ts`：定义 `SessionApprovals`（schemaVersion / sessionId / updatedAt / allowAll / tools / bashCommands）、`SessionApprovalsInput`、`SessionApprovalsReadResult`（found / missing / invalid）与 `SessionApprovalsStore`（getFilePath / read / write / remove）；每个 type 与字段都补中文行内注释说明不变量。
- [x] 1.2 新增 `src/persistence/session-approvals-store.ts`，照 `session-model-settings-store.ts` 的形态实现 `createSessionApprovalsStore(transcriptStore, options)`：路径由 `getSessionFilePath()` 去掉 `.jsonl` 扩展名后拼 `.approvals.json`。
- [x] 1.3 `write` 用「临时文件 + rename」原子替换，写入时使用 `mode: 0o600`；三个集合去重并丢弃空白项后再落盘。
- [x] 1.4 `read` 严格校验结构：JSON 可解析、根节点为对象、`schemaVersion === 1`、`sessionId` 与请求一致、`allowAll` 为布尔、`tools`/`bashCommands` 为数组；任一不符返回 `{kind: 'invalid'}`，`ENOENT` 返回 `{kind: 'missing'}`。数组内的单个脏条目只丢弃自己。
- [x] 1.5 授权为空（两个集合为空且 `allowAll` 为假）时 `write` 降级为 `remove`，不创建空文件。

## 2. `ToolApprovalContext` 接入 sidecar

- [x] 2.1 构造函数改为 `(onUpdate, options?: {store, getCwd, getSessionId})`，`options` 缺省时保持现有纯内存行为，现有 11 处 `new ToolApprovalContext(() => {})` 调用无需改动。
- [x] 2.2 新增 `restoreForSession()`：读取当前 `getSessionId()` 对应的 sidecar，`found` 时替换三个字段，`missing`/`invalid` 时清空三个字段；读取异常不得抛出。
- [x] 2.3 新增 `clearForNewSession()`：清空三个字段并调用 `onUpdate()`。
- [x] 2.4 新增私有 `persist()`：在 `getSessionId()` 为 null 时跳过（journal 尚未首次落盘），写盘失败时保留内存状态并给出一条可见提示，不向调用方抛出。
- [x] 2.5 在 `resolveSelectedOption()` 的 `allow_tool_for_session`、`allow_command_for_session`、`allow_all_for_session` 三个分支落盘后调用 `persist()`。
- [x] 2.6 在 `toggleAllowAllForSession()` 的两个方向都调用 `persist()`，确保关闭操作会写入 `allowAll: false`。

## 3. `AppContext` 会话生命周期挂接

- [x] 3.1 注入可选 `SessionApprovalsStore`，与既有 `sessionModelSettingsStore` 同形参位置；新增 `attachToolApprovalContext(toolApproval)` 供组合根在创建 `ToolApprovalContext` 后绑定。
- [x] 3.2 `loadTranscriptSession()` 成功分支内（`modelContext.restoreSession()` 旁）调用 `restoreForSession()` 并触发一次渲染，使 `TOOLS all` 及时出现。
- [x] 3.3 `forkTranscriptSession()` 成功分支内把当前授权写入新 `sessionId`，实现分支继承。
- [x] 3.4 `/clear` 走的 `clearRecords()` 路径上调用 `clearForNewSession()`。
- [x] 3.5 `deleteTranscriptSession()` 在现有清理 `.settings.json` 的同一个 `try` 块内尽力删除 sidecar。

## 4. 组合根装配

- [x] 4.1 `src/app/main.ts` 创建 `createSessionApprovalsStore(transcriptStore)`，注入 `AppContext`，并在 `new ToolApprovalContext()` 后传入 store 与 `getCwd` / `getSessionId` 绑定。
- [x] 4.2 确认 `src/cli/one-shot.ts` 不实例化 `ToolApprovalContext`，headless 路径不读取也不写入 sidecar。

## 5. 测试

- [x] 5.1 新增 `test/persistence/session-approvals-store.test.js`：往返写入读取、空授权降级为删除、`schemaVersion` 不支持、`sessionId` 不匹配、JSON 损坏、非字符串数组、`remove` 幂等。
- [x] 5.2 扩展 `test/app/app-context.test.js`：同一 session 写入后用新 `ToolApprovalContext` 实例 `restoreForSession()` 能命中缓存；`toggleAllowAllForSession()` 关闭后 sidecar 中 `allowAll` 为假。
- [x] 5.3 扩展 `test/app/app-context.test.js`：`forkTranscriptSession()` 后新 session 拥有相同授权、源 session sidecar 不变；`clearRecords()` 后授权清空；`deleteTranscriptSession()` 后 sidecar 被删除。
- [x] 5.4 补充 fail-closed 用例：损坏的 sidecar 恢复后 `getCachedDecision()` 返回 `null`，审批流程继续。

## 6. 校验与文档

- [x] 6.1 `npm run typecheck`。
- [x] 6.2 `npm test`。
- [x] 6.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 6.4 手动验证：`npm start` 中批准一个高危 bash 命令 → `Ctrl+D` 重启 → `/resume` 同一会话 → 再次触发同一命令应直接执行且状态栏只显示已恢复的授权。
- [x] 6.5 手动验证：`Shift+Tab` 打开 `TOOLS all` → 重启并 `/resume` → `TOOLS all` 仍存在 → `Shift+Tab` 关闭 → 重启并 `/resume` → `TOOLS all` 不再出现。
- [x] 6.6 在 `docs/configuration.md` 补充 sidecar 路径、`/resume` 恢复语义、`/fork` 继承、`/clear` 清空与手工撤销方式。

## 7. 复审收敛

- [x] 7.1 删除 `clearForNewSession()` 中的写盘调用：调用点已解绑 session，该分支恒为 no-op，保留会误导读者以为新会话会写空文件。
- [x] 7.2 `persistToSession()` 改名为 `inheritToNewSession()`，让 `/fork` 调用点自解释。
- [x] 7.3 `updatedAt` 降级为诊断元数据，不参与 `read` 判定。
- [x] 7.4 `read` 对数组脏条目改为过滤，只有结构或身份错误才整文件作废。
- [x] 7.5 `write` 去掉不可达的入参校验抛错，改为归一化，避免把入参问题伪装成磁盘故障。
- [x] 7.6 删除 `SessionApprovalsStoreOptions` 的 7 个注入缝：无调用方使用，直接使用 `fs`。
- [x] 7.7 `remove` 收进 `SessionApprovalsLifecycle.discardSession`，`AppContext` 不再持有第二个 store，构造参数回到 8 个。
- [x] 7.8 合并 `deleteTranscriptSession` 的重复 `try/catch`。
- [x] 7.9 `app-context.test.js` 删除重复实现语义的 fake store。
- [x] 7.10 新增 `sessionApprovalsStoreFailed` observation 事件，写盘失败保留可排查的错误类型与操作方向。
- [x] 7.11 修正文档中「三个集合」的措辞。
