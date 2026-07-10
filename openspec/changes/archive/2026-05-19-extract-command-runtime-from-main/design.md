## Context

`src/app/main.js` 当前约 570 行，既是 app composition root，也内联了 slash command runtime 的状态和 effect interpreter。随着 `/help` 与 fake `/model` 都接入统一 handler/effect/surface 架构，command runtime 的职责已经稳定：解析提交文本、启动 handler、保存活跃 command session、解释 command effects、把后续输入事件分发给活跃 handler。

这次重构的目标不是引入新的状态框架，而是把已经成型的 command runtime 从 `main.js` 中移动到独立 app 子模块，降低 `main.js` 的职责密度，并让后续命令相关演进有更清晰的测试边界。

## Goals / Non-Goals

**Goals:**

- 新增 `src/app/command-runtime.js`，集中承载 slash command session、session config、effect interpreter 和活跃命令事件分发。
- 让 `src/app/main.js` 保留顶层编排职责：依赖注入、terminal setup、普通输入事件分发、普通消息提交、fake agent lifecycle 和渲染入口调用。
- 保持 command handler 契约不变：`match(text)`、`start(text, context)`、可选 `handleEvent(session, event, context)`。
- 保持 command effects、`commandSurface.kind`、`/help`、`/model` 和可注入 slash handler 的行为不变。
- 增加 command runtime 单元测试，并保留 app orchestration 回归测试。

**Non-Goals:**

- 不抽离 fake assistant response lifecycle；这可以作为后续独立 change。
- 不引入 reducer、全局状态对象或事件总线。
- 不改变 `src/commands/` handler 的职责边界。
- 不改变 renderer surface kind 或 footer 渲染协议。
- 不新增第三方依赖。

## Decisions

1. **新增 `createCommandRuntime()`，而不是在 `src/commands/` 内实现运行时。**
   - 理由：`src/commands/` 存放 handler、resolver 和 effect 类型；effect interpreter 需要调用 app 私有动作（重置 composer、追加 transcript、退出、重绘），属于 app orchestration 子层。
   - 备选：把运行时放到 `src/commands/runtime.js`；这会让 commands 层反向感知 app 行为，边界不如 `src/app/command-runtime.js` 清晰。

2. **command runtime 通过回调访问 app 私有动作。**
   - 计划接口包括：`resolveSlashCommand`、`getContext`、`resetComposer`、`leaveHistoryBrowsing`、`appendTranscriptRecord`、`renderFooter`、`exit`。
   - 理由：runtime 不直接持有 composer、transcript 或 renderer，只保存 command session 与 session config。
   - 备选：把整个 app state 对象传给 runtime；这会扩大耦合，也会鼓励 runtime 修改不属于自己的状态。

3. **runtime 对外暴露小而直接的方法。**
   - 建议方法：`hasActiveSession()`、`getSurface()`、`getConfig()`、`getSnapshot()`、`startFromText(text)`、`handleEvent(event)`。
   - `main.js` 在 `submitComposer()` 中先询问 `startFromText(text)`；命中则 runtime 自行解释 effects 并触发必要重绘。
   - `main.js` 在普通事件分发前用 `hasActiveSession()` 判断是否交给 `handleEvent(event)`。

4. **effect interpreter 移动但 effect 语义不变。**
   - `open_command_session`、`update_command_session`、`close_command_session`、`append_transcript_record`、`update_session_config`、`reset_composer` 的行为保持现状。
   - 错误条件保持显式：缺少 session handler/surface、无活跃 session 时更新 session、未知 effect type 都继续抛错。

5. **测试分层：runtime 单测覆盖 effect 和 session，app 测试覆盖集成。**
   - 新增 `test/app/command-runtime.test.js` 覆盖 handler 命中、未命中、effects、事件分发和错误条件。
   - 保留 `test/app/main.test.js` 中 `/help`、`/model`、自定义 handler 的集成测试，确保重构不改变外部行为。

## Risks / Trade-offs

- [Risk] 抽离后 runtime 回调过多，反而难读。→ Mitigation：只注入 runtime 必需的 app 动作，不传完整 app state；若回调膨胀，说明边界需要收紧而不是继续抽。
- [Risk] `main.js` 和 runtime 的 render 调用职责重复。→ Mitigation：约定 command runtime 只在命令 effects 被应用后调用 `renderFooter()`；普通 input/render 路径仍由 `main.js` 管理。
- [Risk] 行为回归不容易从代码 diff 看出来。→ Mitigation：运行现有 app orchestration 测试，并新增 runtime 单测覆盖 effect interpreter。
- [Trade-off] 本次只抽 command runtime，`main.js` 仍保留 response lifecycle 和 history。→ 这是刻意缩小范围，优先降低已经稳定的 slash runtime 复杂度。

## Migration Plan

1. 新增 `src/app/command-runtime.js`，先复制并适配当前 command session/effect interpreter 行为。
2. 修改 `src/app/main.js` 调用 runtime，并删除内联 command runtime 状态与函数。
3. 新增 runtime 单测，调整现有 app 测试断言但保持用户可见行为不变。
4. 更新架构文档和 OpenSpec tasks。
5. 运行 `npm test`、`find bin src test -name '*.js' -exec node --check {} \;`，必要时用 `npm start` 手工验证 `/help`、`/model`。

## Open Questions

- 无。实现时若发现 runtime 需要访问 response lifecycle 或 history 的更多内部状态，应优先通过窄回调解决；不要在本 change 中引入全局状态容器。
