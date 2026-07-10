## 1. TypeScript 工具链配置

- [x] 1.1 安装 `typescript` 和 `@types/node` 作为 devDependencies，并更新 `package-lock.json`。
- [x] 1.2 新增 `tsconfig.json`，配置 Node 20 目标、CommonJS 输出、`rootDir`、`outDir: dist`、`strict: true`、`allowJs: true`，并暂不强制 `checkJs`。
- [x] 1.3 更新 `.gitignore`，确保 `dist/` 作为编译产物不入库。

## 2. 构建、运行和测试脚本

- [x] 2.1 在 `package.json` 中新增 `clean`、`build`、`typecheck` 脚本，统一通过 `tsc` 执行编译和类型检查。
- [x] 2.2 调整 `npm test`，使其先生成 `dist/`，再通过 `node --test dist/test` 运行编译后的测试产物。
- [x] 2.3 调整 `npm start`，使其先生成 `dist/`，再运行编译输出中的 TUI 入口文件。
- [x] 2.4 根据实现选择是否调整 `package.json#bin` 到 `dist/bin/echo-tui.js`；如暂不调整，需在文档中说明本阶段 bin 入口策略。

## 3. 核心纯类型文件

- [x] 3.1 新增 `src/types/input.ts`，定义 input event 的 discriminated union 和相关基础类型。
- [x] 3.2 新增 `src/types/composer.ts`，定义 composer 文本、光标和编辑状态类型。
- [x] 3.3 新增 `src/types/transcript.ts`，定义 transcript record、session metadata 和 transcript session 类型。
- [x] 3.4 新增 `src/types/command.ts`，定义 command surface、command session、command effect、handler 协议等类型。
- [x] 3.5 新增必要的 app/render/agent 类型文件或聚合导出，覆盖 render state、pending state、agent callbacks 等跨层协议。

## 4. 编译产物兼容性

- [x] 4.1 运行 `npm run build`，修复 `allowJs` 编译现有 `bin/`、`src/`、`test/` 到 `dist/` 时暴露的配置或路径问题。
- [x] 4.2 确认 `dist/bin/echo-tui.js` 可由 Node.js 直接加载，且 CommonJS module resolution 与当前源码运行方式一致。
- [x] 4.3 确认编译后的测试文件仍能按原有相对路径加载 `dist/src` 模块。

## 5. 文档和规格同步

- [x] 5.1 更新 `AGENTS.md`，把验证要求从纯 JS `node --check` 扩展为 TypeScript build/typecheck/test 和必要的 JS 语法检查。
- [x] 5.2 更新 `docs/README.md` 和相关架构文档，说明 TypeScript 源码、CommonJS 输出、`dist/` 产物和本地运行/测试命令。
- [x] 5.3 确认 OpenSpec 主规格在归档前可同步 `typescript-build-test-pipeline` 新能力和 `terminal-tui-prototype` 的构建入口修改。

## 6. 验证

- [x] 6.1 运行 `npm run typecheck` 并修复所有 TypeScript 类型检查错误。
- [x] 6.2 运行 `npm test` 并确认编译后测试全部通过。
- [x] 6.3 运行必要的 `node --check` 命令覆盖仍存在的源码 JS 或编译后的关键 JS 产物。
- [x] 6.4 运行 `npx -y @fission-ai/openspec@latest instructions apply --change "add-typescript-build-test-pipeline" --json`，确认任务和规格状态可被 OpenSpec 识别。
