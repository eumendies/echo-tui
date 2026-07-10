## 1. 迁移前基线与约束确认

- [x] 1.1 运行当前 `npm run typecheck`、`npm test` 和 input 相关测试，记录迁移前基线行为。
- [x] 1.2 验证 `node bin/echo-tui.js` 或等价源码入口的当前预期，明确本 change 是否必须维持未 build 源码 bin 可运行。

## 2. input 运行源码迁移

- [x] 2.1 将 `src/input/event-types.js` 迁移为 `src/input/event-types.ts`，保持 `INPUT_EVENTS` key/value 完全不变，并补充与 `src/types/input.ts` 一致的类型边界。
- [x] 2.2 将 `src/input/composer.js` 迁移为 `src/input/composer.ts`，保持 `{ chars: string[], cursor: number }` state、原地修改语义和 Unicode 编辑行为不变。
- [x] 2.3 将 `src/input/key-parser.js` 迁移为 `src/input/key-parser.ts`，让 `parseKeyChunk`、sequence 匹配和字符解析返回现有 input event 类型。
- [x] 2.4 清理并收敛 `src/types/input.ts`、`src/types/composer.ts`，避免与迁移后的运行源码重复或漂移。

## 3. 引用路径与源码入口兼容性

- [x] 3.1 修复 `src/app/`、`test/` 或其他源码 JS 对迁移后 `src/input/*.ts` 模块的引用路径与编译兼容性问题。
- [x] 3.2 根据 1.2 的结论处理 `package.json#bin` / `bin/echo-tui.js` 与 `.ts` 运行源码之间的兼容性边界，并在必要时同步文档或规格说明。
- [x] 3.3 如 input 测试需要调整，更新 `test/input/composer.test.js`、`test/input/key-parser.test.js` 或相关测试入口，使其适配迁移后的运行源码而不改变 runtime 行为。

## 4. 验证与同步

- [x] 4.1 运行 `npm run build`，确认迁移后的 `src/input` 模块能正确输出到 `dist/src/input`，且编译后测试仍能通过相对路径加载。
- [x] 4.2 运行 `npm run typecheck` 并修复迁移引入的所有 TypeScript 错误。
- [x] 4.3 运行 `npm test`，确认 input/composer 行为与编译后测试结果保持不变。
- [x] 4.4 运行必要的 `node --check` 覆盖仍存在的源码 JS 和关键编译产物，并更新 `tasks.md` 勾选状态。
