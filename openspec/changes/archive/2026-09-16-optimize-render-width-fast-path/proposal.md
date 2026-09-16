## Why

大会话的 destructive 全量重绘有明显可感延迟：`/resume` 恢复大会话、Ctrl+O 子会话窗口、主题切换和列宽变化都走同一条完整重绘路径。实测 32MB / 3372 条记录的会话在 120 列终端下单次全量投影需要 3.7s，CPU profile 显示 64.5% 的时间花在 `splitGraphemes` 上——它对每段文本都调用 `Intl.Segmenter`，而实际会话文本里绝大多数是 ASCII 与 CJK 字符，每个码点本身就是独立 grapheme cluster，根本不需要 Unicode 分段。这是纯算法开销，可以做到零渲染语义变化，属于最低风险、立即可收回的收益。

## What Changes

- `splitGraphemes` 增加等价快路径：文本不含任何会影响 cluster 边界的码点（Grapheme_Extend / SpacingMark / Prepend、VS15/VS16、keycap、regional indicator、emoji modifier、Hangul conjoining jamo 等）时直接按码点切分；命中相关码点时回退已缓存的 `Intl.Segmenter` 实例
- `displayWidth` 增加纯 ASCII 快路径（无 ANSI、无制表符、无换行时宽度等于长度），保留既有的 ANSI 剥离、制表位展开与换行重置列语义
- 消息块换行投影（`wrapContentLine`）增加纯 ASCII 切片快路径，换行点与逐 grapheme 版本一致
- 新增差分回归测试：以真实 `Intl.Segmenter` 为参照验证快路径切分逐元素等价，并用桩替换 `Intl.Segmenter` 断言简单文本确实不再经过分段器
- **SHALL NOT 改变任何渲染输出**：公开签名、调用语义、换行点、宽度结果与既有实现逐字节一致
- 不包含 L2（resume 尾部窗口 / reasoning 折叠）与 L3（渲染结果缓存）；它们是独立的后续 change

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `character-width-determination`: 放宽“`splitGraphemes` 必须经 `Intl.Segmenter` 切分”的实现约束，改为“需要时复用同一实例”，并新增等价快路径要求：不含 cluster 边界相关码点的文本按码点切分，含相关码点的文本回退 `Intl.Segmenter`，两条路径的切分结果 SHALL 逐元素一致；`displayWidth` 与换行投影 MAY 使用等价快路径，但 SHALL 保持 ANSI/制表符/换行语义与既有换行点。

## Impact

- 代码：`src/input/graphemes.ts`（快路径与边界码点判定）、`src/render/layout.ts`（`displayWidth` 快路径）、`src/render/blocks.ts`（`wrapContentLine` 快路径）；`src/render/tool-message-renderers/*`、`src/render/footer/*` 等经 `displayWidth` / `splitGraphemes` 的调用点零改动受益
- 行为：终端可见输出不变；composer 编辑单元、`@` mention 高亮索引、footer 行几何、Markdown 换行点继续以同一 grapheme 口径成立
- 性能：实测 32MB / 3372 记录会话（120 列）全量投影 3688ms → 1057ms（-71%），输出 sha1 不变；resize、Ctrl+O、主题切换等复用同一渲染路径的场景同步受益
- spec 影响：`character-width-determination` 中 Segmenter 由“必经”改为“需要时使用”并补充等价快路径要求；`terminal-tui-prototype`、`markdown-terminal-rendering`、`tool-message-rendering` 等涉及 grapheme 一致宽度的需求语义不变，无需 delta
- 风险：快路径若漏判 cluster 边界码点会拆分复合字符（如组合音标、emoji ZWJ 序列）→ 采用保守判定（宁可回退 Segmenter，不漏判），并以差分测试守护
- 测试影响：新增 grapheme 等价性测试文件；既有 render / input 测试断言保持不变
