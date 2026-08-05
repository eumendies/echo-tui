## 1. 数据表与核心宽度判定

- [x] 1.1 新增 `src/render/width-data.ts`：内置 `WIDE_RANGES`、`ZERO_WIDTH_RANGES`、`EMOJI_PRESENTATION_RANGES`、`EMOJI_BASE_RANGES` 四张排序闭区间表（Ambiguous 不建表、一律按 1 列），文件头注明 Unicode/Emoji 数据版本与出处
- [x] 1.2 重写 `src/render/layout.ts` 的 `charWidth`：按 D2 顺序（VS15 → VS16+Emoji base → ZWJ+Emoji base → 双 regional indicator → Emoji_Presentation → 码点求和）决策，删除 `TEXT_PRESENTATION_CODEPOINTS` 硬编码
- [x] 1.3 `splitGraphemes` 模块级缓存 `Intl.Segmenter` 单例，无 Segmenter 时回退码点切分
- [x] 1.4 `displayWidth`/`tabWidthAt`/`wrapText` 复用新宽度逻辑，保持既有签名与换行/制表语义
- [x] 1.5 扩展 `test/render/layout.test.js`：CJK 扩展 B、谚文 jamo、泰文组合符、keycap、旗帜、ZWJ 家族、VS15/VS16、`⚠✓✕♠♪⌘`、ZWSP/ZWNJ/BOM、ANSI/制表符用例

## 2. 统一 grapheme 粒度

- [x] 2.1 `src/render/blocks.ts` 的 `clampToDisplayWidth`、`wrapContentLine` 改用 `splitGraphemes`
- [x] 2.2 `src/input/composer.ts` 编辑模型改为 grapheme 数组：`createComposer`/`insertText`/`setText`/`replaceRange` 用 `splitGraphemes`，`backspace`/`deleteForward`/`moveLeft`/`moveRight`/`moveUp`/`moveDown` 按 cluster 边界
- [x] 2.3 `src/input/file-mentions.ts` 的 `parseFileMentions` 索引改为 grapheme 单元，与 `renderComposer` 对齐
- [x] 2.4 复核所有 `composer.chars` 与 mention range 消费点（undo、file picker、submission 等）不因下标语义变化回归；`file-picker-context.ts` 的 `triggerEnd` 计数同步改为 grapheme 口径
- [x] 2.5 扩展 `test/input/composer.test.js` 与 `test/render/blocks.test.js`：复合 emoji 光标/退格/换行、mention 高亮对齐、消息块 padding 用例

## 3. markdown 表格宽度对齐

- [x] 3.1 复核 `src/render/markdown/markdown-table.ts` 列宽统计、`wrapCell`、`renderAlignedCellLine` 走统一 grapheme 宽度
- [x] 3.2 扩展 `test/render/markdown.test.js`：宽字符/emoji/零宽/VS16/文本呈现符号参与的表格列宽与边框对齐用例

## 4. 全量验证

- [x] 4.1 `npm run typecheck`
- [x] 4.2 `npm test`（1218/1218 通过）
- [x] 4.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.4 手动验证：含 emoji/中文/组合符的 markdown 表格、composer 复合 emoji 编辑（由用户执行）
