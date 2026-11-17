## Why

`ToolApprovalContext` 目前把会话级授权（`Allow <tool> for this session`、`Allow this command for this session`、`Allow all tools for this session`）只保存在内存里，进程退出即丢失。用户在同一次会话中已经逐个批准过高频命令后重启 echo-tui，再 `/resume` 恢复同一个会话仍要从头审批一遍，重复劳动明显，并会诱发用户为了省事而无差别按 Shift+Tab 放开全部审批。

会话级授权本来就应该跟随会话，而不是跟随进程。把它的生命周期对齐到 transcript journal，即可消除重启后的重复审批，同时保持"新会话 = 新安全边界"。

## What Changes

- 新增 session 级授权 sidecar：`~/.echo/echo_tui/projects/<projectKey>/sessions/<sessionId>.approvals.json`，与既有 `<sessionId>.settings.json` 并列，复用同一 `getSessionFilePath` 派生路径与原子替换写法。
- `ToolApprovalContext` 的三个内存缓存仍是本次运行的唯一事实来源，但在会话级 allow 决策后同步写入 sidecar；`Shift+Tab` 关闭全部授权时同样写入，避免重启后授权复活。
- 会话生命周期挂接（统一在 `AppContext`）：
  - `/resume` 加载会话成功 → 从该会话 sidecar 恢复授权；
  - `/fork` 创建新会话成功 → 把当前授权写入新 `sessionId`（分支继承当前安全上下文）；
  - `/clear` 开启新会话 → 清空内存授权；
  - 删除历史会话 → 尽力清理对应 sidecar。
- 读取侧 fail-closed：文件缺失、JSON 损坏、`schemaVersion` 不支持、`sessionId` 不匹配一律视为空集合，回到需要审批，绝不视为全部放行。
- 审批选项文案不变：`for this session` 现在真实覆盖"会话"而不是"进程"，无需增删选项。
- **BREAKING（规格层）**：`openspec/specs/tool-approval/spec.md` 中"会话级允许选项 SHALL NOT 持久化"的要求被反转；授权改为写入 session sidecar，但仍 SHALL NOT 写入 transcript journal 或 `~/.echo/config.json`。

不改变的部分：`Allow all tools for this session` 不写入 `~/.echo/config.json`；headless `echo-tui --once` 既不读取也不写入该 sidecar，继续使用 deny / `--full-access` 策略；工具审批的优先级顺序（会话缓存 → auto 审批模型 → 人工 surface）不变。

## Capabilities

### New Capabilities

- `session-tool-approvals`: 定义会话级工具授权 sidecar 的文件位置、数据结构、原子写与删除语义，以及读取失败时的 fail-closed 行为。

### Modified Capabilities

- `tool-approval`: "工具授权会话级允许选项"要求由"仅进程内、禁止持久化"改为"持久化到所属会话 sidecar，并在 `/resume` 时恢复"。

## Impact

- 新增 `src/persistence/session-approvals-store.ts`、`src/types/session-approvals.ts`。
- 修改 `src/app/state/tool-approval-context.ts`（注入可选 sidecar 绑定、新增恢复/清空/落盘）、`src/app/state/app-context.ts`（会话生命周期挂接）、`src/app/main.ts`（装配 store）。
- 修改 `src/commands/resume-command-handler.ts` 之外的会话切换路径无需改动：`/resume`、`/fork`、`/clear` 均经由 `AppContext` 的既有协调方法。
- 新增 `test/persistence/session-approvals-store.test.js`，扩展 `test/app/app-context.test.js` 的会话生命周期断言。
- 文档与规格：`openspec/specs/tool-approval/spec.md`、`docs/configuration.md`（补充 sidecar 位置与失效规则）。
- 不影响 transcript journal schema、session index schema、`--once` 路径、MCP 审批策略与 auto 审批模式。
