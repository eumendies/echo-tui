## Why

当前 slash command 架构通过 `CommandEffect` 把 handler 的意图交给 `CommandRuntime` 解释，再由 runtime 调用 `main.ts` 注入的 app 回调。这个模型在 `/help`、`/clear` 等简单命令上可用，但 `/compact` 这类需要异步 app 能力的命令让 effect type、runtime 分支、main callback 和业务编排同步膨胀。

现在需要把 command 的业务触达路径改成更直接的 `CommandHost` 命令式模型，让 `CommandRuntime` 回到 command session 和输入分发职责，避免后续新增命令持续扩大 runtime 与 `main.ts`。

## What Changes

- 引入 `CommandHost` 作为 command handler 可使用的受控 app facade，handler 直接调用 host 完成 session、composer、transcript、model、compaction 等命令行为。
- 修改 `CommandHandler` 接口，使 `start` / `handleEvent` 接收 `CommandHost`，不再返回业务 `CommandEffect`。
- 调整 `CommandRuntime`：保留 active command session、surface 快照、命令启动和事件分发，但移除业务 effect 解释职责。
- 迁移现有 `/help`、`/model`、`/clear`、`/compact`、`/resume` handler 到 `CommandHost` 调用模型。
- 删除不再需要的 `CommandEffect` 类型、effect creator、`REQUEST_MANUAL_COMPACTION` 分支和 runtime dependencies 中的业务 callback。
- 将当前 `main.ts` 里的手动压缩业务编排迁移到 command host 相关实现中，使 `main.ts` 只负责创建基础对象和装配。
- 不引入更复杂的双层 host 或额外 flow 文件，先按 `command-host-redesign.md` 中的当前方案落地；后续只有 flow 变长或复用需求明确时再抽 service。

## Capabilities

### New Capabilities
- `command-host-runtime`: 定义 slash command 通过受控 `CommandHost` 直接触达 app 能力、由 `CommandRuntime` 管理命令会话和输入分发的运行模型。

### Modified Capabilities
- `terminal-tui-prototype`: slash command 的用户可见行为保持不变，但命令运行时架构从 effect 解释模型迁移为 host 命令式模型。

## Impact

- 主要影响 `src/types/command.ts`、`src/app/command-runtime.ts`、`src/app/main.ts`、`src/commands/*-command-handler.ts` 和 `src/commands/resolve-slash-command.ts`。
- 需要新增 command host 实现文件承载 command 可用 app 能力和 `/compact` 手动压缩编排。
- 需要更新 command runtime、handler、main 相关测试，保持 `/help`、`/model`、`/clear`、`/compact`、`/resume` 行为不变。
- 不新增运行时依赖，不改变终端渲染方式，不改变 agent/provider API。
