## 1. blocks 子模块

- [x] 1.1 新建 `src/render/blocks/symbol-message-renderer.ts`，搬入 `renderSymbolMessage`、`renderMessageLine`、`padToDisplayWidth`、`wrapContentLine`、`clampToDisplayWidth` 与 `TextStyle`/`SymbolMessageOptions` 类型。
- [x] 1.2 新建 `src/render/blocks/banner-renderer.ts`，搬入 `renderBanner`、`BannerRenderContext`、title art、btw banner、box 行、`centerToDisplayWidth`、`shortenPath`。
- [x] 1.3 新建 `src/render/blocks/message-renderer.ts`，搬入各 role 的 block 与行渲染、`renderShellMessageLines`/`renderShellBlockLines`、`USER_MESSAGE_PREFIX` 与共享的 `withMarkdownRoleColor`。
- [x] 1.4 新建 `src/render/blocks/streaming-text.ts`，搬入 `StreamingContentKind`、`getCommittableStreamingText`、`getCommittableReasoningText`、`renderStreamingCommitLines`。
- [x] 1.5 新建 `src/render/blocks/pending-preview-renderer.ts`，搬入 `renderPendingAssistantLines` 与全部 pending 子渲染及预算 helper。
- [x] 1.6 把 `SubagentViewIndexEntry`、`SUBAGENT_VIEW_INDEX_MAX_ROWS`、`renderSubagentViewIndex`、`createSubagentRunRowText` 迁入 `src/render/subagent-renderer.ts`，并导出被 pending 复用的函数。
- [x] 1.7 删除 `src/render/blocks.ts`，确认没有遗留引用。

## 2. import 迁移

- [x] 2.1 更新 `src/render/live/streaming-renderer.ts`、`src/render/live/shell-renderer.ts` 的 import 到 `blocks/message-renderer` 与 `blocks/streaming-text`。
- [x] 2.2 更新 `src/render/transcript-renderer.ts`、`src/render/app-renderer.ts`、`src/render/footer.ts` 的 import 到对应子模块。
- [x] 2.3 更新 `src/app/subagent-view-controller.ts` 的 import 到 `../render/subagent-renderer`。
- [x] 2.4 运行 `npm run typecheck` 收敛到零错误。

## 3. 测试迁移

- [x] 3.1 按落点把 `test/render/blocks.test.js` 拆分为 `banner-renderer.test.js`、`message-renderer.test.js`、`pending-preview-renderer.test.js`、`streaming-text.test.js`，用例与断言保持不变，只更新 require 路径。
- [x] 3.2 会话窗口索引用例并入 `test/render/subagent-renderer.test.js`；`getCommittableMarkdownText` 用例并入 `test/render/markdown.test.js`。
- [x] 3.3 更新 `test/render/shell-renderer.test.js` 的 `renderShellBlock` import 到 `blocks/message-renderer`。
- [x] 3.4 运行 `npm test`，确认用例总数与结果不变。

## 4. 验证与文档

- [x] 4.1 `npm run typecheck`
- [x] 4.2 `npm test`
- [x] 4.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.4 `openspec validate refactor-split-blocks-subdirectory --strict`
- [x] 4.5 `docs/tui-architecture.md` 模块表与架构图同步 blocks 子模块与会话窗口索引归属。
- [x] 4.6 交互式手工验证（真实 TTY）：banner、各 role 消息与 pending preview、subagent 会话窗口索引、resize destructive replay、shell 运行期投影。
