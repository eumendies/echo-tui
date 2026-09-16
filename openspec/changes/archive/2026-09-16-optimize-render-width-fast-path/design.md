## Context

`src/input/graphemes.ts` 的 `splitGraphemes` 是渲染与输入层的宽度口径源头：`displayWidth`、composer 编辑模型、`@` mention 索引、消息块换行、Markdown/表格投影、工具 rail 布局都经它切分。当前实现对任何文本都调用 `Intl.Segmenter`，并在每次调用上用 `Array.from` 构造 segment 数组。

这条路径是全量重绘的热点。实测 32MB / 3372 条记录的会话（50%/75% 分位为中文与代码混合的 reasoning 文本）在 120 列终端下，`renderTranscriptLines` 的中位耗时 3.6s，CPU profile 显示 `splitGraphemes` 占 64.5% 自身时间，`charWidth` 5.2%、`displayWidth` 2.7%、GC 4.3%。`/resume`、Ctrl+O 子会话窗口、主题切换、列宽变化都走同一条 destructive 全量重绘路径，因此该开销会被反复支付。

关键事实：真实会话文本里绝大多数是 ASCII 与 CJK 码点，而这两类码点在 Unicode 中不存在跨码点的 grapheme cluster 规则——每个码点自身就是一个 cluster。真正需要 `Intl.Segmenter` 的只是组合字符（Grapheme_Extend）、SpacingMark、Prepend、VS15/VS16、keycap、ZWJ 序列、regional indicator 与 Hangul conjoining jamo 等情况。

当前 `src/render/width-data.ts` 已按 Unicode 16.0.0 承载 `WIDE_RANGES`（124 区间）、`ZERO_WIDTH_RANGES`（389 区间，含 Grapheme_Extend、零宽格式符、谚文中声）、`EMOJI_PRESENTATION_RANGES`、`EMOJI_BASE_RANGES`，可直接复用为判据的一部分。

约束：`character-width-determination` 现有需求要求"`splitGraphemes` SHALL 缓存 `Intl.Segmenter` 实例"，需要按本次变更调整为"需要时复用同一实例"；`terminal-tui-prototype`、`markdown-terminal-rendering`、`tool-message-rendering` 中关于 grapheme 一致宽度与换行点的需求语义不变。

## Goals / Non-Goals

**Goals:**

- 在不改变任何终端可见输出、公开签名与调用语义的前提下，把全量重绘中 grapheme 切分与宽度计算的成本降一个数量级
- 让 `/resume` 大会话恢复、resize、Ctrl+O、主题切换等复用同一渲染路径的场景一并受益
- 把"简单文本可跳过 Segmenter"的口径收敛在 `src/input/graphemes.ts` 单点，避免各调用点各自加速

**Non-Goals:**

- 不做 L2（resume 尾部窗口投影、reasoning 折叠）与 L3（按 record 缓存渲染结果）：前者改变可见内容，后者解决重复重绘，属于独立 change
- 不改变 grapheme cluster 的判定语义、宽度决策顺序（VS15/VS16/ZWJ/keycap/Emoji_Presentation）与 Ambiguous 按 1 列的既有口径
- 不引入第三方依赖、不新增构建期数据生成脚本、不改动 `width-data.ts` 的 Unicode 数据表内容
- 不为测试新增生产代码分支或参数

## Decisions

### 1. 判据用"保守白名单 + 零宽守卫"，而不是"黑名单排除组合字符"

快路径允许条件：文本中每个码点同时满足 (a) 命中 `SIMPLE_TEXT_RANGES` 白名单，(b) 不命中 `ZERO_WIDTH_RANGES`。

白名单按"确定不存在跨码点 cluster 规则"的区块构造：ASCII、Latin-1 与 Latin Extended、希腊/西里尔字母区、General Punctuation 到 Dingbats 的常用标点与符号区、CJK 标点与假名、CJK 统一表意与扩展区、全角/兼容形式、谚文音节与兼容谚文。**未列入白名单的脚本（Indic、Thai、Lao、Tibetan、Myanmar、Khmer、阿拉伯、Sinhala、emoji 区、Hangul conjoining jamo 区等）一律回退 `Intl.Segmenter`。** `ZERO_WIDTH_RANGES` 守卫负责白名单区块内的窄例外：谚文浊点 U+3099–U+309A、半角浊点 U+FF9E–U+FF9F、CJK 声调符 U+302A–U+302F、软连字符 U+00AD、ZWJ U+200D、VS15/VS16、keycap U+20E3、emoji modifier U+1F3FB–U+1F3FF 等都在该表内，命中即回退。

备选方案是"黑名单排除组合字符区"（实测该写法在目标会话上同样达到 -69%），但它要求枚举全部 Grapheme_Cluster_Break 相关集合（SpacingMark 与 Prepend 的码点分散在数十个脚本区块中，`ZERO_WIDTH_RANGES` 并不覆盖 SpacingMark，实测 `a` + U+0E33/U+0903/U+093E/U+0D4E 均被合并为单 cluster）。漏判会拆分复合字符、破坏宽度与换行口径，而白名单漏判只损失性能。正确性优先，因此选白名单。

代价：白名单外的脚本（如泰文、天城文、emoji 密集文本）继续走 Segmenter，与优化前无差别。

### 2. 快路径以码点为单位切分，不做 cluster 合并复制

命中判据时用 `Array.from` 按码点直接收集（字符串迭代器保证 astral 平面字符成对），不复制 cluster、不构造 `Intl.Segmenter` 迭代器、不产生中间 segment 对象。选 `Array.from` 而非手动逐码点 push：两者语义等价（孤立代理、星号面 CJK、emoji、CRLF 用例全部一致），整段文本语料上实测快约 2 倍；但真实渲染是逐行调用（实测 221,457 次、平均 63.5 字符），该差异在端到端投影里不可测，因此这只是可读性与局部吞吐的改进，不计入性能收益。非命中路径保持既有实现（复用模块级 `sharedSegmenter`）。

`splitGraphemes` 的对外形态不变：仍返回 `string[]`，元素语义仍是 grapheme cluster（简单文本中 cluster 恰等于码点）。导出面不扩大，避免把判据泄漏成公共 API。

### 3. `displayWidth` 与 `wrapContentLine` 只增加"纯 ASCII 快速返回"

两处额外守卫都限定在"无 ANSI、无制表符、无换行、无非 ASCII 码点"这一最窄条件：

- `displayWidth`：满足条件时返回 `text.length`（ASCII 每码点 1 列，等于按码点求和），保留 ANSI 剥离、制表位展开、换行重置列的既有语义——含 ESC、`\t`、`\n`、`\r` 或非 ASCII 时一律走原路径
- `wrapContentLine`：满足条件时按 `width - prefixWidth` 预算做切片换行，其中预算非正时退化为每行 1 个字符，与逐 grapheme 分支在 `column > prefixWidth` 判定下的行为一致；含制表符或非 ASCII 时走原分支

实测两者合计贡献约 5 个百分点（120 列：1129ms → 951ms），收益小于判据本身，但改动仅十余行、复用同一份 ASCII 判定，因此保留。

### 4. 等价性用 `Intl.Segmenter` 作 oracle 校验，不引入 UCD 数据依赖

新增两类测试：

1. **差分测试**：对构造语料（ASCII/CJK/拉丁/标点，以及组合音标、VS15/VS16、keycap、ZWJ 家庭 emoji、旗帜、emoji modifier、SpacingMark、Prepend、Hangul jamo）断言 `splitGraphemes` 与直接使用 `Intl.Segmenter` 的结果逐元素一致
2. **白名单穷举校验**：以 `Intl.Segmenter` 为 oracle 遍历白名单码点（大区块按固定步长抽样），断言除 `ZERO_WIDTH_RANGES` 命中外，`base + 该码点` 不被合并为单个 cluster。该断言把"白名单不得包含 cluster 边界码点"变成可执行不变量，无需引入 Unicode 数据文件
3. **快路径命中守卫**：在专测文件内先于首次调用把 `Intl.Segmenter` 替换为抛错桩，断言简单文本仍能正常切分（证明快路径确实生效），随后恢复真实实现再断言复合文本走 Segmenter

## Risks / Trade-offs

- [白名单误收 cluster 边界码点 → 复合字符被拆分、宽度与换行错位] → 白名单只收"确定无跨码点规则"的区块 + `ZERO_WIDTH_RANGES` 守卫；以 `Intl.Segmenter` 为 oracle 做穷举/抽样校验；本地用 14MB 真实会话语料做全量投影 sha1 对照（2956 条记录、0.1% 记录回退）
- [性能收益在其他脚本占比高的会话上消失] → 与优化前行为等价（回退 Segmenter），无回退风险；收益定位是"实际会话文本以 ASCII/CJK 为主"
- [快路径判定本身成为新热点] → 判定是一次线性码点扫描 + 区间二分；实测该扫描成本远低于 Segmenter 迭代，且 CJK 占比高的会话仍为负收益显著（-69%）
- [测试运行时间增加] → 白名单穷举对大区块抽样（扩展平面 131k 码点全量遍历过慢），抽样步长在 tasks 中固定并注释
- [对外语义被误用为"码点切分"契约] → 不新增导出、不写"码点即 cluster"的公共文档；spec 明确两条路径结果 SHALL 逐元素一致

## Migration Plan

1. `src/input/graphemes.ts` 落地判据与快路径（唯一语义改动点，行为等价）
2. `src/render/layout.ts`、`src/render/blocks.ts` 落地两处 ASCII 守卫
3. 新增差分/穷举/桩守卫测试
4. 复测大会话全量投影耗时与输出 sha1，与优化前对照
5. `npm run typecheck`、`npm test`、`node --check`、`openspec validate --strict`
6. `docs/tui-architecture.md` 同步快路径语义；`ROADMAP.md` 第 12 项标记 L1 完成

回滚：改动集中在三个文件，无持久化格式变化、无配置或 CLI 变化，回滚只需还原代码。

## Open Questions

（无：L1 范围、行为等价目标、"不改变可见输出"的验收口径已确认。）
