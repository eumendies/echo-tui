## Context

当前 `read_files` 专属 renderer（`src/render/tool-message-renderers/read-files.ts`）只消费现有文本 envelope，不改写 transcript。text 类型结果只输出一行摘要（`text: <path>  lines: <range> (<count>)`），正文不进入终端；目录结果平铺全部 entries，靠共享的 `TOOL_RESULT_MAX_DISPLAY_LINES = 12` 兜底截断；结果前缀使用 `⎿`（U+23BF），与内容行可能使用的 `│`（U+2502）不是同一组 box-drawing 字符，等宽字体下竖线无法对齐。

用户需求：结果投影展示有界内容预览（避免终端刷一大段），树状连接（header 与内容行竖线对齐），单文件占满专属预算，多文件明确等分，不做语法高亮。

## Goals / Non-Goals

**Goals:**
- 为 text envelope 增加带行号的有界预览（默认展示文件头部若干行）。
- 为 directory envelope 增加 entries 展示预算与可计数省略提示，header 补充 entries 计数。
- 引入 read_files 专属 30 行总预算，内容行由内容型 envelope 等分，单文件占满，总行数恒不超预算。
- 用 box-drawing 字符（`├─` / `└─` / `│`）构建树状投影，最后一个 envelope 闭合。
- 全程 `toolOutput` 单色，无语法高亮；内容行按宽度尾部省略，保证 1 源行 = 1 物理行。

**Non-Goals:**
- 不改动 `src/tools/read-files/` handler 输出协议、transcript record、attachments 或 `details.display` metadata。
- 不改动共享 `TOOL_RESULT_MAX_DISPLAY_LINES = 12` 与其他 renderer（grep/glob/web_fetch 等）行为。
- 不引入可交互的展开/折叠能力（当前 TUI 无工具结果交互展开机制）。
- 不做 middle/tail 采样或空行过滤，预览保持所见即所得。

## Decisions

### 1. 树状字符使用 `├─` / `└─` / `│`，弃用 `⎿`
`⎿`（U+23BF）与 `│`（U+2502）不属于同一组 box-drawing 字符，常见等宽字体下竖线位置不一致，无法可靠对齐。改为与 grep 结果树同族的 `├─` / `└─` / `│`，字体保证同一列对齐。

结构规则（与 grep `renderGrepMatchTreeLines` 的 `hasFollowingRoot` 语义一致）：
- 非最后一个 envelope 的 header 前缀 `  ├─ `，最后一个用 `  └─ `（树闭合）。
- 非最后一个 envelope 的内容行 rail 前缀 `  │ `，最后一个闭合为 `    `（竖线不悬空）。
- 备选方案：保留 `⎿` 并假设其竖线居中对齐——不可靠，已否决。

### 2. 内容行按宽度尾部省略，保证 1 源行 = 1 物理行
预览行与 directory entries 行在输出前按当前 safe render width 减去前缀宽度后的可用宽度做尾部省略（`…`），复用 grep 的 `clampToDisplayWidth` 思路。这样 1 个源行恒为 1 个物理行，行数预算精确可控，不需要依赖 `renderPrefixedLines` 的自动换行（换行会把一行撑成多物理行、挤占预算）。

备选方案：依赖自动换行 + 全局截断兜底——长行会膨胀物理行数，多文件时后面的文件 header 被截掉，已否决。

### 3. 专属 30 行预算 + 内容型 envelope 等分
```
H = envelope 数量（每个 1 行 header，所有类型）
R = 30 - H - (outputTruncated ? 1 : 0)
p = floor(R / contentCount)   // contentCount = 成功 text 数 + directory 数
```
- 每个成功 text envelope 获得 p 行预览；content 行数超出 p 时显示前 p-1 行 + 1 行 `… +N more`（p = 1 时显示 1 行不加提示，p = 0 不显示），与 directory entries 的省略规则一致。
- 每个 directory envelope 获得 p 行 entries 预算；entries 超出 p 条时显示前 p-1 条 + 1 行 `… +N more`（p = 1 时显示 1 条不加提示，p = 0 不显示）。
- 余数留白，总投影行数恒 ≤ 30，无需额外的共享截断提示。
- image/pdf/error envelope 只占 1 行 header，不参与内容行分配。
- `output_truncated` 保留为整块末尾一行提示并计入预算。

备选方案 A：每文件固定 preview 行数（如 6）——多文件时前几个文件占满预算、后面文件完全不可见，与"每个文件都有一点"的诉求冲突。
备选方案 B：per-file 上限 + text 优先于 directory——混合场景下 text 会把预算吃光、directory 只剩 header，规则也更绕；统一等分更公平可预期。
备选方案 C：单文件也设 preview 上限——用户明确要求单文件占满预算，已否决。

### 4. 文本预览取 head 前 p 行，保留行号前缀
预览直接取 `content:` block 的前 p 个源行（已带 `N │ ` 行号前缀），同文件内行号右对齐到该文件预览行的最大行号宽度（grep 行列 gutter 同款）。与 `offset/limit` 分页语义一致，用户看到的正是模型拿到的内容；需要看其他范围时本来就会再发带 offset 的调用。

备选方案：middle/tail 采样或结构采样——解析复杂且对"确认读对文件"没有额外价值，已否决。

### 5. 全程 `toolOutput` 单色
header、行号 gutter、正文预览、目录条目统一使用 `blockText(theme, 'toolOutput', ...)`（低强调语义色，与 grep 匹配树一致），不应用 syntax theme、markdown 样式或固定色值，避免预览喧宾夺主。

### 6. 渲染管线保持"解析 → 逐 envelope 分配 → 合并"
`renderReadFilesToolResultLines` 仍是唯一入口：解析失败返回 `null` 走通用 fallback（契约不变）；解析成功后先按公式分配每个 envelope 的行数预算，再逐 envelope 渲染树状行，最后合并返回。所有渲染函数保持纯函数，只消费 `record.text`，会话回放与 resize 重渲染天然兼容。

## Risks / Trade-offs

- [终端字体对 box-drawing 字符渲染差异极小，但 `…` 省略号宽度在不同字体可能不同] → 省略号按 `charWidth` 计算扣除，遵循现有 layout 宽度计算。
- [30 行预算大于共享 12 行，单次 read_files 投影占 transcript 空间变大] → 仅 read_files 专属，其余工具不变；30 行是"有限度"的明确边界，多文件场景仍受等分约束。
- [`output_truncated` 标记行占用 1 行预算，极端场景下内容预览少 1 行] → 信息完整性优先，规则在 specs 中明确。
- [历史 transcript 中旧格式记录（无新字段）] → renderer 只解析现有 envelope 协议，新旧记录渲染结果一致，无需迁移。
- [目录 entries 行也可能超宽] → 与预览行同样做宽度省略，保证预算精确。

## Migration Plan

纯渲染层改动，无数据迁移。改动后运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`，并由用户通过 `npm start` 手动验证树状投影效果。回滚只需还原 `read-files.ts` 单个文件。

## Open Questions

无。
