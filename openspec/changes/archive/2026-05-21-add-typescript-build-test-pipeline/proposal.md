## Why

当前项目仍是纯 JavaScript + JSDoc/checkJs 风格约束，随着 TUI runtime、command effect、context 和测试 fixture 增多，对象形状和协议边界主要靠约定维护，继续扩展会增加误传参数、漏处理 effect、测试 seam 污染生产代码的风险。

这次变更先建立 TypeScript 编译与测试管线，并引入少量核心纯类型文件，为后续逐步迁移源码到 TypeScript 提供稳定基础；本阶段不追求全量 `.ts` 迁移。

## What Changes

- 新增 TypeScript 开发依赖和 `tsconfig.json`，以 `tsc` 作为唯一编译入口。
- 保持运行产物为 CommonJS，编译输出到 `dist/`；不切换 ESM，不引入 bundler，不使用 ts-node/tsx 作为运行时 loader。
- 新增 `build` / `clean` / `typecheck` 等脚本，并调整测试管线，使 CI/本地验证可以覆盖 TypeScript 编译结果。
- 新增少量纯类型定义文件，用于描述输入事件、composer、transcript record、pending state、command surface、command effect、command session 等核心协议形状。
- 保持现有 TUI 用户可见行为、命令协议语义、transcript 持久化格式和 OpenAI adapter 行为不变。
- 更新仓库文档和验证命令，明确 TS 源码、CommonJS 输出和 `dist/` 不入库的约束。

## Capabilities

### New Capabilities

- `typescript-build-test-pipeline`: TypeScript 编译、类型检查、CommonJS 输出和测试运行管线。

### Modified Capabilities

- `terminal-tui-prototype`: 项目结构与验证要求从“无 build step 的 JavaScript CommonJS 项目”调整为“TypeScript 源码经 `tsc` 编译为 CommonJS 后运行和测试”。

## Impact

- 影响 `package.json` / `package-lock.json`：新增 TypeScript 相关 devDependencies 和 build/test/typecheck scripts。
- 影响根目录配置：新增 `tsconfig.json`，更新 `.gitignore` 忽略 `dist/`。
- 影响 `bin/`、`src/`、`test/` 的验证方式：运行和测试目标逐步转向 `dist/` 编译产物。
- 影响 `docs/README.md`、`AGENTS.md` 和可能的架构文档：同步 TS 编译、测试和语法/类型检查命令。
- 影响 OpenSpec 主规格：需要新增 TypeScript 管线规格，并同步 terminal prototype 对项目语言/构建入口的要求。
