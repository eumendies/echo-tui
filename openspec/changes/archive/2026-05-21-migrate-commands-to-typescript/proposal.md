## Why

TypeScript 编译/测试管线和 input 运行源码迁移已经完成，但 `src/commands/` 仍然停留在 JavaScript，slash command handler、effect 和 resolver 的运行时协议还没有真正消费 `src/types/command.ts`。commands 层本身以纯逻辑和结构化对象装配为主，依赖面清晰，是继续推进渐进式 TypeScript 迁移的低风险下一步。

## What Changes

- 将 `src/commands/command-effects.js` 迁移为 TypeScript，保持 `COMMAND_EFFECT_TYPES` 常量和各 effect 工厂函数返回形状不变。
- 将 `src/commands/resolve-slash-command.js` 迁移为 TypeScript，复用并收紧 slash handler 匹配与默认 handler 装配协议。
- 将 `src/commands/help-command-handler.js`、`model-command-handler.js`、`clear-command-handler.js`、`resume-command-handler.js` 迁移为 TypeScript，保持现有命令触发条件、surface 形状和事件处理行为不变。
- 清理并收敛 `src/types/command.ts` 与迁移后 commands runtime 源码之间的重复或漂移定义。
- 保持 CommonJS 编译输出、`npm test` 入口、现有 Node.js 内置测试框架和 slash command 行为不变。
- 必要时修复 `src/app/command-runtime.js`、`src/app/main.js`、`test/` 对迁移后 commands 模块的编译兼容和引用路径问题，但不在本 change 中迁移 `src/app/command-runtime.js` 自身到 TypeScript。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `typescript-build-test-pipeline`: 增加 commands 运行源码模块迁移为 TypeScript 的要求，覆盖 command effects、resolver 和默认 slash command handlers，并要求编译后 CommonJS 产物与现有测试路径保持兼容。

## Impact

- 影响 `src/commands/command-effects.js`、`src/commands/resolve-slash-command.js`、`src/commands/help-command-handler.js`、`src/commands/model-command-handler.js`、`src/commands/clear-command-handler.js`、`src/commands/resume-command-handler.js`：这些文件将改名为 `.ts` 并补充静态类型。
- 影响 `src/types/command.ts`：迁移时需要让运行源码真正复用现有 command surface、effect、session 和 handler 协议。
- 可能影响 `src/app/command-runtime.js`、`src/app/main.js` 与相关测试：它们会继续通过编译后的 CommonJS 产物消费 commands 模块，因此需要核对模块导出形状和相对路径兼容性。
- 影响 `test/commands/`、`test/app/` 与 render 层相关测试：测试需确认 slash command 触发、surface 渲染和 effect interpreter 行为不变。
- 不新增运行时依赖，不引入 bundler、Babel、ts-node、tsx、自定义 loader 或 ESM 迁移。
