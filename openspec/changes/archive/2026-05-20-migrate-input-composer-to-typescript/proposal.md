## Why

TypeScript build/test 管线已经建立，但当前核心输入链路仍是 JavaScript，`InputEvent`、composer state 和 key parser 的协议还没有被真实运行源码消费。优先迁移 input/composer 这条纯逻辑链，可以用较低风险验证渐进式 TS 迁移方式，并为后续 command/runtime 迁移提供更稳的输入类型边界。

## What Changes

- 将 `src/input/event-types.js` 迁移为 TypeScript，保留现有 `INPUT_EVENTS` 常量和值。
- 将 `src/input/composer.js` 迁移为 TypeScript，复用并收紧 `{ chars: string[], cursor: number }` composer state 类型。
- 将 `src/input/key-parser.js` 迁移为 TypeScript，使 `parseKeyChunk` 返回现有 input event discriminated union。
- 保持现有 CommonJS 编译输出、`allowJs` 渐进迁移策略和 `node --test dist/test` 测试路径不变。
- 显式检查 `package.json#bin` 仍指向源码入口时的兼容性；若 `.ts` 运行源码使直接源码入口无法加载，需在本 change 内给出低风险兼容策略或更新文档说明支持的 build-first 运行路径。
- 保持当前输入编辑、Unicode/中文字符处理、控制键解析和 composer 行为不变。
- 不迁移 `src/app/main.js`、render、command runtime、terminal 或 OpenAI adapter。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `typescript-build-test-pipeline`: 增加首批运行源码模块从 JavaScript 迁移到 TypeScript 的要求，覆盖 input event、composer 和 key parser，并要求编译产物和测试路径保持兼容。

## Impact

- 影响 `src/input/event-types.js`、`src/input/composer.js`、`src/input/key-parser.js`：文件将改名为 `.ts` 并补充静态类型。
- 可能影响引用这些模块的 `require` 路径或测试引用方式，但运行产物仍由 `tsc` 输出 CommonJS `.js` 文件。
- 影响 `src/types/input.ts`、`src/types/composer.ts`：迁移时应复用或调整这些纯类型定义，避免与运行源码重复漂移。
- 影响 `test/input/composer.test.js`、`test/input/key-parser.test.js`：测试需确认迁移后编译产物行为不变；是否迁移测试文件本身由实现阶段决定。
- 可能影响 `bin/echo-tui.js` 或相关文档：运行源码入口与 `.ts` 模块加载之间存在兼容性边界，必须在实现阶段明确处理。
- 不新增运行时依赖，不引入 bundler、Babel、ts-node、tsx、自定义 loader 或 ESM 迁移。
