## 1. 提取 composer submission controller

- [x] 1.1 定义 `AssistantTurnSubmission`、command/reference 最小能力和必填运行协作边界，确保不向 `createApp()` 增加测试专用参数。
- [x] 1.2 新增 `ComposerSubmissionController`，迁移 `submitDraft()`、`submitComposer()`、pending dispatch 锁和串行 claim 循环，保留 command/skill/shell/file mention/reference 路由顺序。
- [x] 1.3 在 `main.ts` 中用真实 shell callback、reference error callback 和 assistant turn callback 装配 submission controller，删除原闭包实现但保留 shell、runner、render 和 interruption 生命周期。
- [x] 1.4 增加 submission controller 测试，覆盖普通提交副作用、单槽排队、重复 Enter、自动 dispatch、queued slash、后来草稿隔离和 interruption 后不重复处理。
- [x] 1.5 增加 pending file mention 测试，覆盖文本展开、图片附件传递、发送时读取语义和异步预处理期间阻止并发 Enter。

## 2. 提取 input event controller

- [x] 2.1 定义 input controller 的必填 state/action/local-surface 协作边界，并由 controller 持有 key parser。
- [x] 2.2 新增 `InputEventController`，按原顺序迁移 `handleEvent()`、composer/history 编辑和 `handleChunk()`，保持同一 chunk 的异步等待语义。
- [x] 2.3 将 Submit 接到 submission controller，将 Esc 接到 pending/reference/shell/assistant 既有处理链，并保持 active modal、command、reference preparation 和本地 info surface 优先级。
- [x] 2.4 在 `main.ts` 中注册 input controller 的稳定 chunk/event handler，删除原输入闭包和不再需要的 imports，同时保留 local surface 的 render-state 所有权。
- [x] 2.5 增加 input controller 测试，覆盖 surface 拦截顺序、reference preparation、本地 info surface、model tuning、快捷键、file picker、slash suggestions、Tab、composer 编辑、Esc、Submit 和 Exit。

## 3. 结构与行为回归

- [x] 3.1 确认 `main.ts` 只保留生产装配、render/append、resize、MCP/config lifecycle、shell execution、assistant interruption、start 和 exit，不新增细碎 wrapper 或重复状态。
- [x] 3.2 更新 `docs/tui-architecture.md`，说明两个 controller、main composition root 和 assistant/shell/input 的职责边界。
- [x] 3.3 运行提交、command runtime、assistant runner、file mention、input parser、footer 和 app renderer 相关测试，修复任何行为差异。

## 4. 完整验证

- [x] 4.1 运行 `npm run typecheck`。
- [x] 4.2 运行 `npm test`。
- [x] 4.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 和 `git diff --check`。
- [x] 4.4 整理真实终端回归清单，覆盖 streaming 期间排队、pending file mention、queued slash、Esc 两阶段处理、shell 中断、file picker、slash suggestions 和 resize；交由用户执行交互验证。
