## 1. 结构准备

- [x] 1.1 梳理 `src/app/` 现有模块引用关系，确认移动文件后的目标目录与 import 更新范围。
- [x] 1.2 创建粗粒度 app 子目录：state、command；`assistant-turn-runner.ts` 直接保留在 `src/app/` 根下，避免为单文件新增目录。

## 2. main.ts 瘦身

- [x] 2.1 在 `src/app/assistant-turn-runner.ts` 新增 assistant turn 模块，承接普通 assistant turn 的 `runAgent` callbacks、streaming、tool call/result、complete、abort/error 收尾逻辑。
- [x] 2.2 修改 `main.ts` 的 `submitComposer()`，保留提交前阻塞判断、slash command 分流、shell mode 分流，并调用 assistant turn runner 模块。
- [x] 2.3 保留 `main.ts` 内的 render 协调、surface 优先级、shell mode、输入路由、MCP bootstrap 和退出清理，不继续拆成细碎 wrapper。

## 3. app 文件归类

- [x] 3.1 将 AppContext 及 composer/model/render/slash suggestion/transcript/turn/tool approval/user question context 移入 app 状态职责目录，并更新相对 import。
- [x] 3.2 将 app 内部 command host/runtime 移入 app 命令运行职责目录，并保持与 `src/commands/` handler 目录职责区分。
- [x] 3.3 更新源码与测试中引用 app 内部模块的 import/require 路径，不新增旧路径 re-export shim，除非发现明确公开 API 依赖。

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`，修复目录迁移或类型引用问题。
- [x] 4.2 运行 `npm test`，修复结构重组导致的测试失败。
- [x] 4.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`，确认 JS 测试与脚本语法有效。
- [x] 4.4 对变更结果做最终检查，确认未恢复测试专用 options/dependencies，且 `main.ts` 主流程比拆分前更清晰。
