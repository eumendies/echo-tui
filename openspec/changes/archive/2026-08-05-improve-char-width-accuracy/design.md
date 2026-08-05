## Context

`src/render/layout.ts` 是唯一宽度判定入口，`charWidth`/`displayWidth`/`splitGraphemes` 被 render 层 20+ 处引用（markdown 表格列宽、自动换行、padding、composer 光标坐标、footer 各 surface）。当前实现有三个层面的缺陷：

1. **覆盖缺口**：宽字符区间止于 `U+FFE6`，CJK 扩展 B+（`U+20000–3FFFD`）、西夏文、女书等全部落回 1 列；组合字符只覆盖 `U+0300–036F`，泰文、谚文中声（`U+1160–11FF`）、keycap 圈（`U+20E3`）等按 1 列；ZWSP/ZWNJ/BOM 等零宽字符未处理。
2. **准确度偏差**：emoji 按整块区间近似，`♠♪⌘⌥⏎☀☁★☆✈` 等文本呈现符号被算成 2 列；变体选择符不参与 base 宽度决策（`⚠️`/`✓️` 带 VS16 仍按 1 列，`©️`/`1️⃣` 整簇按 1 列）。
3. **口径不一致**：`displayWidth`/markdown/styled-line/footer text 走 `splitGraphemes`，而 `blocks.ts` 的 `clampToDisplayWidth`/`wrapContentLine` 与 composer 编辑模型走 `Array.from` 码点数组；同一段 ZWJ emoji 家族在不同函数里宽度分别为 2 和 8，导致换行、补齐、光标坐标互相矛盾。

约束：仓库不引入第三方面板/渲染依赖；构建流程只允许 `tsc` + 资产拷贝脚本；目标 Node.js >= 20（`Intl.Segmenter` 可用）；宽度判定是纯函数，测试走 `node:test`。

## Goals / Non-Goals

**Goals:**
- 用一个静态数据模块覆盖 Unicode 宽字符（含扩展平面）、零宽/组合字符、emoji 呈现字符，grapheme 级决策准确反映主流终端渲染。
- 统一所有渲染路径的切分粒度，保证同一文本在任何函数里宽度一致。
- 保持 `charWidth`/`displayWidth`/`splitGraphemes` 对外签名不变，调用点零改动。
- 补全测试矩阵，防止回归。

**Non-Goals:**
- 不引入生成脚本或构建期数据下载；数据表一次性计算后静态提交。
- 不处理 `stripAnsi` 对 OSC 序列的扩展（渲染层自产文本无此问题，另行跟踪）。
- 不改变 `safeRenderWidth` 语义与 tab 展开逻辑。
- 不承诺所有终端字形渲染完全一致（终端间 emoji 呈现存在固有差异），只对齐主流 UTF-8 终端。

## Decisions

### D1: 数据以排序区间表静态内嵌，运行时二分查找

`src/render/width-data.ts` 导出四张 `readonly [number, number][]` 区间表，全部排序且不重叠，来源固定为 Unicode 16.0 / Emoji 16.0，文件头注释标注版本、出处 URL 与生成日期。运行时用二分查找判断码点归属，O(log n)。

- `WIDE_RANGES`：EastAsianWidth 的 W/F 区间（覆盖 CJK 全平面含扩展 B+、西夏文、女书、全角符号等）。
- `ZERO_WIDTH_RANGES`：DerivedCoreProperties 的 Grapheme_Extend 区间，合并零宽格式字符（ZWSP/ZWNJ/ZWJ/BOM/软连字符）与谚文中声 `U+1160–11FF`。
- `EMOJI_PRESENTATION_RANGES`：emoji-data 的 Emoji_Presentation=Yes 区间。
- `EMOJI_BASE_RANGES`：emoji-data 的 Emoji=Yes 区间（含 `©®™♠❤` 等文本呈现默认但可用 VS16 转 emoji 的 base）。

East Asian Ambiguous（A）区间不建表、不参与判定：框线（`│─┼`）、块元素（`▌`）等布局字符在终端中固定按 1 列渲染，若允许按 2 列计算会与 `'─'.repeat(width)` 等硬编码布局错位，故一律按 1 列。

备选：引入 `wcwidth`/`string-width` 依赖。否决理由：Kuhn 版 `wcwidth` 不含 emoji（U+1F600 返回 1），仍需自写 emoji/VS/grapheme 层；`string-width` 也不处理 Emoji_Presentation；仓库依赖极简且 AGENTS.md 对第三方引入保守。静态内嵌无运行时依赖、可离线审查。

### D2: grapheme 级宽度决策，VS15/VS16 优先

`charWidth(char)` 保留单参签名，入参视为一个 grapheme cluster（调用方须经 `splitGraphemes` 切分），决策顺序：

1. cluster 含 VS15（`U+FE0E`）→ 强制文本呈现，按 D3 码点求和。
2. cluster 含 VS16（`U+FE0F`）且含 Emoji base → 2。
3. cluster 含 ZWJ 且含 Emoji base → 2（单字形）。
4. cluster 为双 regional indicator → 2（旗帜）。
5. cluster 含 Emoji_Presentation 码点且无 VS15 → 2。
6. 其余 → 码点求和：WIDE 2 / ZERO 0 / 其余 1（Ambiguous 一律按 1）。

该顺序同时兼容现有测试断言（`⚠✓✕` 无 VS 为 1、`✅`/`🙂`/家族 emoji 为 2），并修正 `⚠️`/`✓️`/`©️`/`1️⃣` 应为 2、`♠♪⌘` 应为 1 的错误。现有 `TEXT_PRESENTATION_CODEPOINTS` 硬编码集合删除，由数据表驱动。

### D3: 非 emoji 路径按码点求和，零宽字符不占列

cluster 内逐码点：命中 `ZERO_WIDTH_RANGES` 记 0，命中 `WIDE_RANGES` 记 2，否则记 1，求和。这保证 `e\u0301`（1）、谚文音节（`ᄀ`2 + `ᅡ`0 = 2）、泰文组合符（0）正确。

### D4: 统一 grapheme 粒度，composer 编辑模型改为 grapheme 数组

- `splitGraphemes` 模块级缓存 `Intl.Segmenter` 单例（无 `Intl.Segmenter` 时回退码点切分）。
- `blocks.ts` 的 `clampToDisplayWidth`、`wrapContentLine` 的 `Array.from(text)` 改为 `splitGraphemes(text)`。
- `src/input/composer.ts` 的 `chars` 数组元素由码点改为 grapheme cluster：`createComposer`/`insertText`/`setText`/`replaceRange` 用 `splitGraphemes`，`backspace`/`deleteForward`/`moveLeft`/`moveRight`/`moveUp`/`moveDown` 按 grapheme 边界操作。
- `src/input/file-mentions.ts` 的 `parseFileMentions` 索引改为 grapheme 单元，与 `renderComposer` 的 `composer.chars` 对齐；`composer.chars.join('')` 仍是原始文本，@mention 的 `start`/`end` 语义从码点下标变为 grapheme 下标。

备选：仅改渲染层、保留码点编辑模型。否决理由：光标按码点移动会把 ZWJ 序列/旗帜从中间切开，编辑与渲染仍不一致；grapheme 模型是 composer 错位问题的根因之一。

### D5: 性能

`charWidth` 内联二分查找 + 每 cluster 单次扫描；`displayWidth` 仍逐 grapheme 计算；Segmenter 单例化后高频 footer 重绘不再反复构造实例。数据表为纯常量，`Readonly` 冻结，模块加载零开销。

## Risks / Trade-offs

- [数据表版本漂移] Unicode 升级后表格过期 → 文件头注明版本与出处，升级时按注释流程重新生成并跑测试矩阵。
- [终端 emoji 呈现差异] 部分终端把 ZWJ 家族渲染为多字形（宽度 8），本实现按单字形 2 处理 → 遵循主流终端行为与既有测试断言，文档说明取舍。
- [composer 模型迁移回归] `chars` 语义从码点变 grapheme，@mention 下标、undo/fork 等依赖 index 的逻辑可能受影响 → 全面搜索 `composer.chars` 与 mention range 消费点，测试补齐 grapheme 边界用例。
- [Intl.Segmenter 版本差异] 不同 Node 版本对 grapheme 边界（如 emoji 序列）判定可能不同 → 数据表决策不依赖 Segmenter 的宽度归类，仅依赖切分边界；测试在 CI Node 版本上锁定。

## Migration Plan

1. 先提交 `width-data.ts` 数据模块与 `charWidth`/`displayWidth` 重写（行为兼容，测试全绿）。
2. 再迁移 `blocks.ts` 与 composer 编辑模型（grapheme 化），同步更新 composer/file-mentions 测试。
3. 每步独立可跑 `npm run typecheck` + `npm test`；回滚只需撤销对应提交，无数据迁移。

## Open Questions

