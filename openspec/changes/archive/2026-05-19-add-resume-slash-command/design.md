## Context

当前 TUI 的 transcript records、input history 和 command session 都只存在于 `createApp()` 的进程内状态中。renderer 只负责根据 records 投影可见 transcript，不持久化任何内容；slash 命令通过 resolver、handler、command runtime effect interpreter 和 app 层窄回调完成集成。

`/resume` 需要跨进程恢复会话，因此会引入两个新边界：一是按当前工作目录分区的本地 transcript store，二是能够从 store 读取会话并替换当前 transcript records 的 app 层能力。这个能力应继续遵守现有架构：handler 不直接读写 app 私有状态或文件系统，renderer 不理解具体命令名，也不承担列表分页逻辑。

## Goals / Non-Goals

**Goals:**

- 把 transcript records 按当前工作目录持久化到 `~/.echo/echo_tui/`。
- 每个工作目录可以保存多个 session，并可按 `updatedAt` 倒序列出。
- 新增纯 `/resume` slash 命令，打开 `select` command surface 展示当前目录可恢复 session。
- `/resume` 一次最多显示 5 条 session，由 handler 维护可见窗口和选中项，不修改 footer renderer 的 select surface 契约。
- Up/Down 选择不循环；到达列表边界后继续按同方向键保持在边界。
- Enter 恢复选中的 session，替换当前 transcript records 并完整重绘 app snapshot，只显示恢复出来的 transcript，不追加额外提示 record。
- Esc 取消 `/resume`，关闭命令会话并恢复普通 composer。
- 保持 `/resume more` 回退普通消息路径，保持 response 期间不进入 `/resume`。
- 明确 `/clear` 只清当前可见 transcript，不删除已保存 session；清空后后续普通消息应创建新 session。

**Non-Goals:**

- 不支持 `/resume <id>`、`/resume list` 或带参数恢复。
- 不支持 session 删除、重命名、搜索、跨目录恢复或自动启动恢复。
- 不持久化 Up/Down 使用的 input history。
- 不新增 footer renderer 的通用虚拟列表或分页能力。
- 不引入第三方依赖或数据库；第一版只使用 Node.js 内置模块和 JSON 文件。

## Decisions

1. **存储根目录使用 `~/.echo/echo_tui/`，并按 cwd hash 分区。**
   - 理由：用户明确希望总路径放在 `~/.echo`；把 `echo_tui` 作为子目录可以避免和其他工具数据混杂。
   - 每个项目目录使用 hash 作为分区目录，避免真实路径中的斜杠、空格或特殊字符影响文件路径。
   - 可在 project metadata 中保存真实 cwd，便于调试和将来展示。
   - 备选：写到当前 repo 的 `.echo_tui/`；这会污染工作区并增加误提交历史文件的风险。

2. **第一版使用 JSON session 文件，不维护独立 index。**
   - `listSessions(cwd)` 可以扫描当前项目分区下的 `sessions/*.json`，解析 metadata 后按 `updatedAt` 倒序返回。
   - 理由：实现简单，没有 index 与 session 文件不一致的问题；当前原型规模下解析少量 JSON 可接受。
   - 备选：维护 `index.json`；列表更快，但会引入一致性和修复逻辑，第一版不需要。

3. **持久化只覆盖 transcript records，不覆盖 input history。**
   - transcript 是会话内容，input history 是当前进程内编辑便利能力，两者在 `/clear` 设计中已经明确分离。
   - 恢复 session 后不应把旧 user messages 自动塞回当前输入历史，避免 Up/Down 行为突然跨进程变化。

4. **record commit 后立即保存 session。**
   - 用户 record 追加后保存一次，assistant 完成 record 追加后再保存一次。
   - 如果进程在 assistant 回复前退出，保存最后一个 user record 是真实状态；恢复后看到未回复的 user 消息可接受。
   - 文件写入应使用临时文件加 rename 的 atomic write 模式，避免半截 JSON。

5. **通过新的 command effect 恢复 session。**
   - 新增类似 `load_transcript_session` 的 effect/helper，由 `/resume` handler 在 Enter 时返回。
   - command runtime 解释该 effect 时调用 app 注入的 `loadTranscriptSession(sessionId)` 窄回调。
   - app 层负责从 store 加载 records、替换 `transcriptRecords`、设置 `currentSessionId` 并执行 destructive/full snapshot 重绘。
   - 备选：handler 直接读 store 并返回 records；这会让 handler 触碰文件系统和 app 私有状态，破坏现有边界。

6. **滚动窗口由 `/resume` handler 的 session data 管理。**
   - session data 保存完整 session metadata、绝对 `selectedIndex`、`windowStart` 和 `pageSize: 5`。
   - surface 的 `options` 只传当前窗口内最多 5 条，`selectedIndex` 使用窗口内相对索引。
   - Up/Down 更新 data 和 surface；不改 `renderSelectSurface()`。
   - 选择不循环：列表有明确的时间顺序，边界保持比跳转更自然。

7. **恢复不追加本地提示 record。**
   - 用户要求恢复后只显示恢复出来的 session transcript。
   - 恢复的反馈就是当前 transcript 被替换并重绘；不污染历史会话内容。

8. **`/clear` 在持久化语义下 detach 当前 session。**
   - `/clear` 清空当前可见 transcript records 后，应把 `currentSessionId` 置空，但不删除或覆盖旧 session 文件。
   - 后续普通消息创建新 session，避免把旧 session 保存为空。

## Risks / Trade-offs

- [Risk] 扫描并解析所有 session JSON 在历史很多时变慢。→ Mitigation：第一版接受原型规模；store API 保持封装，后续可以在不改 `/resume` handler 的前提下引入 `index.json`。
- [Risk] JSON 文件损坏导致 `/resume` 失败。→ Mitigation：store 读取时跳过无法解析或 schemaVersion 不支持的 session；必要时在无可用 session 的 info surface 中说明没有可恢复会话。
- [Risk] 恢复 session 会替换当前可见 transcript。→ Mitigation：当前 transcript 在 record commit 后已经持久化，切换不会删除历史；恢复不追加提示，行为保持清晰。
- [Risk] 将来有非目录维度的工作区或多窗口并发写同一 session。→ Mitigation：第一版 scope 固定为单进程本地 JSON；atomic write 降低半写风险，但不承诺并发合并。
- [Risk] `~/.echo/echo_tui` 里保存对话内容可能包含敏感信息。→ Mitigation：明确文档说明存储位置；不写入项目目录，降低误提交风险。

## Migration Plan

1. 新增 transcript store，默认根目录为 `~/.echo/echo_tui/`，测试可注入临时目录。
2. 在 app 层维护 `currentSessionId`，普通 user/assistant record commit 后创建或更新当前 session。
3. 新增恢复 session 的 command effect 和 app 层窄回调。
4. 新增 `/resume` handler：读取当前目录 session metadata，构造最多 5 条的 select surface，处理非循环 Up/Down、Enter、Esc。
5. 注册 `/resume` 到默认 resolver，并保持 `/resume more` 普通消息回退。
6. 调整 `/clear` 的 app 层行为：只清当前可见 transcript，并 detach `currentSessionId`，不删除旧 session 文件。
7. 补充 store、handler、runtime、app 集成、文档和手工验证。

## Open Questions

- 无。当前第一版固定为纯 `/resume`、不循环选择、不追加恢复提示、最多显示 5 条、存储在 `~/.echo/echo_tui/`。
