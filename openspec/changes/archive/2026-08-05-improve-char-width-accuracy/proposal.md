## Why

当前 `src/render/layout.ts` 的 `charWidth` 是手写区间启发式：宽字符区间止于 `U+FFE6`（CJK 扩展 B+ 全部算 1 列）、组合字符只覆盖拉丁变音、emoji 按整块近似（把 `♠♪⌘` 等文本呈现符号误算成 2 列）、变体选择符不参与宽度决策。叠加 `blocks.ts` 与 `renderComposer` 按码点切分、其余路径按 grapheme 切分的口径不一致，导致同一段文本换行/补齐/光标坐标互相矛盾，出现 markdown 表格边框与 composer 输入框错位。

## What Changes

- 新增静态 Unicode 宽度数据模块 `src/render/width-data.ts`：内置四张排序区间表（宽字符 W/F、零宽/组合、Emoji_Presentation、Emoji base），来源标注 Unicode 版本，不引入构建期生成脚本与运行时依赖。
- 重写 `charWidth` 为 grapheme 级决策：VS15 强制文本呈现、VS16 + Emoji base 按 2 列、ZWJ emoji 序列与旗帜按 2 列、Emoji_Presentation 按 2 列、其余按码点求和（宽 2 / 零宽 0 / 窄 1）；删除 `TEXT_PRESENTATION_CODEPOINTS` 硬编码集合。
- 统一 grapheme 粒度：`blocks.ts` 的 `clampToDisplayWidth`/`wrapContentLine` 改用 `splitGraphemes`；composer 编辑模型与 `renderComposer` 以 grapheme cluster 为基本单元（光标移动、退格、删除、@mention 索引均对齐）。
- 缓存 `Intl.Segmenter` 实例，消除逐帧重复实例化。
- East Asian Ambiguous 字符一律按 1 列处理：不提供宽度配置，避免框线等布局字符在宽度计算与终端实际渲染之间错位。
- 扩展 `test/render/layout.test.js` 与 markdown 表格测试矩阵，覆盖 CJK 扩展 B、谚文 jamo、泰文组合符、keycap、旗帜、ZWJ 序列、VS15/VS16、文本呈现符号与表格列宽对齐。

## Capabilities

### New Capabilities

- `character-width-determination`: 终端显示宽度判定的数据表、grapheme 级决策逻辑与对外 API（`charWidth`/`displayWidth`/`splitGraphemes`）的稳定语义。

### Modified Capabilities

- `markdown-terminal-rendering`: pipe table 的列宽计算与单元格对齐必须基于准确的终端显示宽度，覆盖宽字符、零宽字符、emoji 与变体选择符场景。
- `terminal-tui-prototype`: composer 的编辑与渲染以 grapheme cluster 为基本单元，光标坐标、自动换行与 @mention 高亮索引保持一致。

## Impact

- `src/render/layout.ts`: `charWidth` 重写、`displayWidth` 复用、`splitGraphemes` 缓存、`renderComposer` grapheme 化。
- `src/input/composer.ts`、`src/input/file-mentions.ts`: 编辑模型由码点数组改为 grapheme 数组。
- `src/render/blocks.ts`: 两处 `Array.from` 改为 `splitGraphemes`。
- 新增 `src/render/width-data.ts`；`test/render/layout.test.js`、`test/render/markdown.test.js`、`test/input/composer.test.js`、`test/config/app-settings-config.test.js` 扩展。
