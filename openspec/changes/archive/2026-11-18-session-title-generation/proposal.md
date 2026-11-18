## Why

`/resume` 与 `/reference` 目前用首条用户消息的前 60 个字符作为会话标题，长消息会让列表项变成难以辨认的截断文本，`/resume` 甚至只显示时间和消息条数。用户在多会话之间切换时缺少稳定、可辨识的标识。同时 statusline 只展示模型与目录，无法回答"我现在在哪个会话里"。

项目已有把标题写入 `sessions/index.json` 并缓存的机制，但每次 journal 指纹变化都会用派生标题覆盖，因此需要先把该字段改造成可继承的权威值，再接入一次性的轻量模型生成。

## What Changes

- 新增会话标题生成：首条用户消息提交后，异步调用一次无工具、强制 `low` effort 的独立模型请求，把标题写入 session index；请求不阻塞 assistant turn 的首个响应。
- 改造 `sessions/index.json` 的标题语义：从"每次指纹失配都重新派生的缓存值"改为"可继承的权威值"，首次缺失时才回退到现有 `createSessionTitle` 派生逻辑。
- 标题生成可配置：新增 `sessions.titleGenerationEnabled` 开关与 `sessions.titleModelProfileId` 引用。关闭时不生成；开启且未指定 profile 时使用当前生效模型并覆盖为 `low` effort；指定时使用该 profile 并同样覆盖为 `low` effort。
- `/resume` 列表项改为显示标题（与 `/reference` 对齐），不再只显示时间与消息条数。
- `/fork` 创建的新会话继承源会话标题。
- statusline 增加当前会话标题分段，窄终端下按现有裁剪策略优先丢弃。
- 标题生成失败、超时或输出不合法时静默降级为现有派生标题，不影响会话可用性。

## Capabilities

### New Capabilities

- `session-title-generation`: 定义会话标题的生成时机、请求约束、输出规范化、存储与继承语义、手动/生成优先级、失败降级，以及 statusline 展示规则。

### Modified Capabilities

- `transcript-journal-persistence`: session index 中的 `title` 从可重建的派生缓存改为可继承的权威值，指纹失配只刷新计数与指纹，不再覆盖已有标题。
- `resume-session-browser-performance`: 会话浏览器列表项由"更新时间 · 消息条数"改为"更新时间 · 会话标题"。
- `session-fork-command`: fork 产生的新会话需要继承源会话标题，而不是等待新会话的首条消息重新派生。
- `config-surface-settings`: 常规设置中新增标题生成模型 profile 选择项，非必填，只允许引用已保存的有效 profile。

## Impact

- 存储与索引：`src/persistence/transcript-store.ts`（`listSessionSummaries`、`updateSessionIndex`）、`src/types/transcript.ts`（`TranscriptSessionIndexState`）。
- 会话状态：`src/app/state/transcript-context.ts`（`sessionTitle` 生命周期、`forkSession`、`loadSession`、undo 截尾）。
- 标题生成：新增独立生成器模块，复用 `src/agent/agent-setup.ts` 的 `createConfiguredAgent` 与现有 provider adapters，不装配工具 registry；形状对齐 `src/app/tool-approval/resolver.ts` 的一次性独立请求。
- 触发：`src/app/assistant-turn-runner.ts` 在首条用户记录落盘后触发一次，按 session 去重。
- 配置：`src/config/app-settings-config.ts` 新增 `titleGenerationModelProfileId`、校验与应用；`/config` 常规 Tab 增加对应行。
- 展示：`src/commands/resume-command-handler.ts` 的列表项、`src/types/render.ts` 与 `src/render/footer/composer-surface.ts` 的 statusline 分段。
- 不改变 journal 的 append-only 记录格式与 replay 语义，不新增第三方依赖，不改变 headless `--once` 路径的行为。
