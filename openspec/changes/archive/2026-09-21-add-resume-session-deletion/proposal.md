## Why

`/resume` 目前只能恢复历史会话，用户无法在终端内清理不再需要的会话。手动定位并删除持久化文件既不直观，也容易遗留索引或 model/effort sidecar；因此需要提供带二次确认的受控删除流程。

## What Changes

- 在 `/resume` 会话浏览器中支持删除当前选中的历史会话，并以 `d` 作为删除快捷键。
- 删除操作必须进入独立确认界面；只有按 `Enter` 明确确认后才删除，`Esc` 取消后返回浏览器。
- 当前正在使用的持久化会话不可删除，避免当前 transcript 与 journal 写入指针失配。
- 删除成功后移除会话 JSONL journal、更新轻量 session index，并清理同 session 的 model/effort settings sidecar；浏览器刷新候选和预览状态。
- 删除期间隔离或失效异步预览结果，避免迟到结果覆盖确认界面或删除后的列表。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `resume-session-browser-performance`: `/resume` 会话浏览器增加删除入口、确认/取消语义、删除后的列表刷新和异步预览隔离。
- `transcript-journal-persistence`: 持久化 session 支持受控删除 JSONL journal，并保持 session index 与真实 journal 集合一致或可重建。
- `session-model-settings`: 删除 session 时清理对应的 model/effort settings sidecar。

## Impact

- 受影响代码包括 `/resume` 命令 handler、命令 host 的 transcript 端口、transcript context/store、session model settings store，以及相关 TypeScript 协议类型。
- 受影响的持久化文件为项目分区 `sessions/<sessionId>.jsonl`、`sessions/index.json` 与 `<sessionId>.settings.json`。
- 不引入第三方依赖，也不改变 `/reference`、`--once` 或现有会话恢复语义。
