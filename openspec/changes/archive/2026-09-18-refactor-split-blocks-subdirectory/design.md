## Context

`blocks.ts` 893 行的责任分布（拆分前行号）：

| 责任块 | 行范围 | ~行数 |
| --- | --- | --- |
| 类型与常量（banner 上下文、符号消息选项、title art、user 前缀） | 12–43 | 32 |
| banner 渲染与专属 helper | 45–206 | 162 |
| role block 包装 | 207–285 | 79 |
| role 消息行 | 287–367 | 81 |
| streaming 稳定文本边界 | 369–427 | 59 |
| shell 消息行 | 429–447 | 19 |
| pending preview（含五种子预览与预算 helper） | 448–595、654–793 | ~290 |
| 子 Agent 会话窗口索引 | 596–652 | 57 |
| 符号消息与行宽布局工具 | 795–893 | 99 |

引用面：`app-renderer`（`renderBanner`）、`footer.ts`（`renderPendingAssistantLines`）、`transcript-renderer`（role block/行）、`live/streaming-renderer`（committable、commit 行、assistant/reasoning 行）、`live/shell-renderer`（shell 行/block）、`app/subagent-view-controller`（会话窗口索引）以及两个测试文件。

## Goals / Non-Goals

**Goals:**

- 把 `blocks.ts` 拆成职责单一、命名自解释的 `blocks/` 子模块，render 层不再有接近千行的平铺文件。
- 保持行为与导出签名零变化：仅搬运代码与更新 import。
- 单向依赖：子模块 → `../layout`、`../colors`、`../markdown`、`../tool-message-renderer`、`../subagent-renderer`；`subagent-renderer` → `blocks/symbol-message-renderer`；不引入反向依赖与 barrel。

**Non-Goals:**

- 不改渲染输出、终端序列、导出签名，不改 `footer/*`、`tool-message-renderers/*` 等其他目录。
- 不合并 `symbol-message-renderer` 与 `layout.ts`（前者负责样式化行组装，后者负责宽度口径）。
- 不为测试新增生产入口；测试按新模块缝拆分。

## Decisions

### 1. 子目录 `src/render/blocks/` + 5 个职责模块，不做 re-export 门面

沿用仓库既有的家族目录风格（`footer/`、`tool-message-renderers/`）。删除 `blocks.ts` 而不是保留 barrel：纯转发层会隐藏符号出处，并且让"哪个模块负责什么"重新变得模糊。

### 2. 布局工具与角色色助手就地归属

- `renderSymbolMessage`、`renderMessageLine`、`padToDisplayWidth`、`wrapContentLine`、`clampToDisplayWidth` 归 `symbol-message-renderer.ts`（被 banner、message、pending 三处复用）。
- `withMarkdownRoleColor` 归 `message-renderer.ts`（assistant 行与 streaming 预览共用的 role 前缀着色），pending 模块按需引入。
- `normalizePreviewMaxLines`、`truncatePendingPreviewLines` 属 pending 预览预算，留在 `pending-preview-renderer.ts`。

### 3. 会话窗口索引迁入 `subagent-renderer.ts`

`renderSubagentViewIndex` 只被 `app/subagent-view-controller` 使用，且依赖 `footer/window` 的 `createSelectedWindowRows`、`layout` 的宽度/单行折叠工具与 `blocks/symbol-message-renderer` 的 `clampToDisplayWidth`。迁入 `subagent-renderer.ts` 后：`blocks/pending-preview-renderer` → `subagent-renderer` → `blocks/symbol-message-renderer`，方向单向无环。

### 4. `streaming-text.ts` 作为独立稳定边界模块

`getCommittableStreamingText`、`getCommittableReasoningText`、`renderStreamingCommitLines` 被 `live/streaming-renderer` 与测试消费，且实现依赖 `message-renderer` 的行渲染与 `markdown` 的边界判定；独立成模块后共享该边界的两侧都不必再依赖"大 blocks"。

### 5. 测试按新缝拆分，行为不变由既有断言兜底

`test/render/blocks.test.js` 按落点拆成四个文件，会话窗口索引用例并入 `subagent-renderer.test.js`，`getCommittableMarkdownText` 用例并入 `markdown.test.js`；断言与用例名保持不变，仅更新 require 路径与文件归属。

## Risks / Trade-offs

- [搬运过程中漏改 import] → 用 `tsc`（`noUnusedLocals`）逐轮收敛；每步运行 typecheck + 全量测试
- [子模块之间出现循环依赖] → 依赖方向在决策 1–4 中固定；`blocks/*` 不反向依赖 live/transcript/snapshot
- [测试拆分造成断言漂移] → 只搬运用例、不改断言与用例名；`npm test` 数量应保持不变（除文件归属外）
- [目录清单类 spec 文本与实际不符] → 本变更的 spec delta 以「render 模块拆分」的最终文本为基线，归档时按顺序覆盖为超集

## Migration Plan

1. 新建 `src/render/blocks/` 5 个模块并按落点搬运；删除 `blocks.ts`；会话窗口索引迁入 `subagent-renderer.ts`。
2. 更新 7 个源文件的 import；运行 typecheck 收敛到零错误。
3. 拆分测试文件并更新 `shell-renderer.test.js` import；运行全量测试。
4. 同步 `docs/tui-architecture.md`；运行完整验证（typecheck、test、node --check、openspec validate）。

回滚：仅涉及模块文件搬迁，无持久化、配置或 CLI 变化。
