## Why

`src/render/blocks.ts` 现为 893 行，单文件平铺了 9 类互不相同的渲染责任：banner、各 role 的 block 与行渲染、pending preview（含 tool/subagent/reasoning/shell/streaming 五种子预览）、streaming 稳定文本边界、子 Agent 会话窗口索引，以及符号消息与行宽布局工具。上一轮 render 层拆分后，`blocks.ts` 成为 render 层最大的文件，继续承载新投影（新 role、新 pending 类型）会让定位与评审成本持续上升。

## What Changes

- 把消息行与 block 渲染 primitives 收敛到 `src/render/blocks/` 子目录，按投影职责拆分为 5 个模块并删除平铺的 `blocks.ts`（不保留 re-export 门面）：
  - `banner-renderer.ts`：`renderBanner` 与 banner 专属 helper（btw 变体、box 行、居中、路径缩短）。
  - `message-renderer.ts`：各 role 的 block 与逐行渲染（user/reference/assistant/error/compaction/local notice/reasoning），以及被运行期投影复用的 shell 消息行与 block。
  - `pending-preview-renderer.ts`：`renderPendingAssistantLines` 与全部 pending 子渲染、预览预算与折叠 helper。
  - `symbol-message-renderer.ts`：`renderSymbolMessage`、行内前缀/缩进/换行/补宽与宽度截断工具。
  - `streaming-text.ts`：`getCommittableStreamingText`、`getCommittableReasoningText`、`renderStreamingCommitLines`。
- 子 Agent 会话窗口索引（`SubagentViewIndexEntry`、`renderSubagentViewIndex`、`createSubagentRunRowText`）迁入 `src/render/subagent-renderer.ts`，与同域渲染同址。
- 只做搬运与 import 更新：所有导出签名、渲染输出、终端序列与行为保持不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `terminal-tui-prototype`：「模块边界」需求补充 blocks 子目录组织约束，并把建议目录结构中的 `src/render/blocks.ts` 替换为 5 个子模块路径。

## Impact

- 受影响代码：删除 `src/render/blocks.ts`；新增 `src/render/blocks/` 下 5 个模块；`src/render/subagent-renderer.ts` 增补会话窗口索引渲染。
- 受影响 import（6 个源文件）：`live/streaming-renderer.ts`、`live/shell-renderer.ts`、`transcript-renderer.ts`、`app-renderer.ts`、`footer.ts`、`app/subagent-view-controller.ts`。
- 受影响测试：`test/render/blocks.test.js` 按新缝拆分为 `banner-renderer.test.js`、`message-renderer.test.js`、`pending-preview-renderer.test.js`、`streaming-text.test.js`；会话窗口索引用例并入 `subagent-renderer.test.js`；`getCommittableMarkdownText` 用例并入 `markdown.test.js`；`shell-renderer.test.js` 更新 import。
- 文档：`docs/tui-architecture.md` 模块表与架构图同步。
