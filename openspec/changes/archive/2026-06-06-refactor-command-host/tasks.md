## 1. CommandHost 与类型协议

- [x] 1.1 在 `src/types/command.ts` 中定义 `CommandHost`、新的 `CommandHandler.start(text, host)` / `handleEvent(session, event, host)` 协议，并移除 `CommandEffectResult` 依赖路径。
- [x] 1.2 新增 `src/app/command-host.ts`，封装 session 以外的 composer、transcript、model、compaction、ui 等 command 可用 app 能力。
- [x] 1.3 将 `main.ts` 中的手动压缩编排迁移到 command host 相关实现，保持 responding 锁、working spinner、`prepareAgent`、`runCompaction(force)`、成功/无需压缩/失败反馈语义不变。

## 2. CommandRuntime 重构

- [x] 2.1 修改 `src/app/command-runtime.ts`，移除 effect interpreter，保留 active command session、`getSurface()`、`getSnapshot()`、`hasActiveSession()`、`startFromText()` 和 `handleEvent()`。
- [x] 2.2 让 runtime 在启动命令和分发事件时调用 handler 的新协议，并在 handler 执行后维持现有 footer 重绘行为。
- [x] 2.3 删除 runtime dependencies 中的业务 callback，包括 reset/clear/load/append/requestManualCompaction 等 effect 解释专用字段。

## 3. 迁移现有命令

- [x] 3.1 迁移 `/help` handler：通过 host reset composer、open/close session，保持 help surface 行为不变。
- [x] 3.2 迁移 `/clear` handler：通过 host open confirm、close/reset/clear transcript，保持确认、取消和输入历史保留行为不变。
- [x] 3.3 迁移 `/compact` handler：通过 host open confirm，确认后触发手动压缩，删除 `REQUEST_MANUAL_COMPACTION` 相关路径。
- [x] 3.4 迁移 `/resume` handler：通过 host 读取可恢复 session metadata、更新 select surface、确认后恢复 session。
- [x] 3.5 迁移 `/model` handler：通过 host 读取模型命令信息、保存模型选择和显示安全错误 surface。
- [x] 3.6 更新 `resolve-slash-command.ts` 的默认 handler 装配，去掉 handler 构造期业务子 context 注入。

## 4. 删除旧 effect 模型残留

- [x] 4.1 删除或清空不再使用的 `src/commands/command-effects.ts`，同步移除 `CommandEffect`、各类 effect type 和 creator 导出。
- [x] 4.2 清理 `src/types/command.ts`、`src/types/app.ts`、`src/types/agent.ts` 和相关 import 中的旧 effect / callback 类型残留。
- [x] 4.3 确认 `main.ts` 不再为具体 command 保留 `runManualCompactionTurn` 或新增业务 callback。

## 5. 测试与验证

- [x] 5.1 更新 command handler 单元测试，使用 fake `CommandHost` 断言 session、composer、transcript、model、compaction 调用。
- [x] 5.2 更新 command runtime 测试，验证 start/event 分发、active session、surface snapshot、exit 处理和 footer render 时机。
- [x] 5.3 更新 app/main 相关测试，覆盖 `/help`、`/model`、`/clear`、`/compact`、`/resume` 用户可见行为保持不变。
- [x] 5.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`，修复发现的问题。
