## 1. 迁移前基线与范围确认

- [x] 1.1 运行当前 `npm run typecheck`、`npm test` 和 commands 相关测试，记录迁移前 slash command 行为基线。
- [x] 1.2 确认本 change 只覆盖 `src/commands/` 运行源码迁移，不迁移 `src/app/command-runtime.js`、`src/app/main.js` 或测试文件到 TypeScript。

## 2. Commands 运行源码迁移

- [x] 2.1 将 `src/commands/command-effects.js` 迁移为 `src/commands/command-effects.ts`，保持 `COMMAND_EFFECT_TYPES` key/value 和各 effect 工厂返回对象不变。
- [x] 2.2 将 `src/commands/help-command-handler.js` 迁移为 `src/commands/help-command-handler.ts`，保持 `/help` 匹配、surface 和 Esc 关闭行为不变。
- [x] 2.3 将 `src/commands/model-command-handler.js` 迁移为 `src/commands/model-command-handler.ts`，保持 `/model` 模型信息归一化、surface 和只读事件行为不变。
- [x] 2.4 将 `src/commands/clear-command-handler.js` 迁移为 `src/commands/clear-command-handler.ts`，保持 `/clear` confirm surface、确认和取消 effect 行为不变。
- [x] 2.5 将 `src/commands/resume-command-handler.js` 迁移为 `src/commands/resume-command-handler.ts`，保持 session 列表、窗口滚动、选择确认和取消行为不变。
- [x] 2.6 将 `src/commands/resolve-slash-command.js` 迁移为 `src/commands/resolve-slash-command.ts`，保持默认 handler 装配顺序和 resolver 首个命中语义不变。

## 3. 类型收敛与引用兼容

- [x] 3.1 清理并收敛 `src/types/command.ts`，让 command surface、effect、session 和 handler 类型表达迁移后的真实 runtime shape。
- [x] 3.2 修复 `src/app/command-runtime.js`、`src/app/main.js`、`test/` 或其他源码 JS 对迁移后 `src/commands/*.ts` 模块的编译兼容性问题。
- [x] 3.3 如测试需要调整，更新 `test/commands/*`、`test/app/*` 或相关测试入口，使其适配迁移后的运行源码而不改变 runtime 行为。

## 4. 文档、规格与验证

- [x] 4.1 如 commands 文件扩展名或 build-output 语义影响文档，更新 `docs/tui-architecture.md`、`docs/README.md` 或相关 OpenSpec 主规格说明。
- [x] 4.2 运行 `npm run build`，确认迁移后的 `src/commands` 模块能正确输出到 `dist/src/commands`，且编译后 app/tests 能通过相对路径加载。
- [x] 4.3 运行 `npm run typecheck` 并修复迁移引入的所有 TypeScript 错误。
- [x] 4.4 运行 `npm test`，确认 slash command、app runtime 和 render surface 行为保持不变。
- [x] 4.5 运行必要的 `node --check` 覆盖仍存在的源码 JS 和关键编译产物，并更新 `tasks.md` 勾选状态。
