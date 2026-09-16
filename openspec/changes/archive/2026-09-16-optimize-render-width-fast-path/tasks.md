## 1. grapheme 快路径

- [x] 1.1 在 `src/input/graphemes.ts` 增加"简单文本"判据与码点级切分快路径：命中判据时按码点返回元素，否则回退既有模块级 `sharedSegmenter`
- [x] 1.2 判据实现为"保守白名单 + 零宽守卫"：白名单覆盖 ASCII、Latin-1/Latin Extended、希腊与西里尔字母、常用标点与符号区、CJK 标点与假名、CJK 统一表意与扩展区、全角/兼容形式、谚文音节与兼容谚文；`ZERO_WIDTH_RANGES` 命中码点一律回退
- [x] 1.3 白名单外的脚本（Indic、Thai、Lao、Tibetan、Myanmar、Khmer、阿拉伯、Sinhala、emoji 区、Hangul conjoining jamo 区）不加入白名单，保持回退 Segmenter
- [x] 1.4 保持 `splitGraphemes` 对外签名与导出不变（`src/render/layout.ts` 的再导出保持原样），不新增仅供测试使用的参数或分支
- [x] 1.5 在 `src/render/layout.ts` 为 `displayWidth` 增加纯 ASCII 快路径：无 ESC、制表符、换行与非 ASCII 码点时返回文本长度，其余情况走既有路径
- [x] 1.6 在 `src/render/blocks.ts` 为 `wrapContentLine` 增加纯 ASCII 切片快路径：按 `width - prefixWidth` 切片，预算非正时退化为每行 1 个字符；含制表符或非 ASCII 时走既有逐 grapheme 分支

## 2. 等价性测试

- [x] 2.1 新增差分测试：对构造语料（ASCII/CJK/拉丁/标点 + 组合音标、VS15/VS16、keycap、ZWJ 家庭 emoji、旗帜、emoji modifier、SpacingMark、Prepend、Hangul jamo）断言 `splitGraphemes` 与 `Intl.Segmenter` 结果逐元素一致
- [x] 2.2 新增白名单穷举校验（以 `Intl.Segmenter` 为 oracle）：遍历白名单码点、扩展平面大区块按固定步长抽样，断言除 `ZERO_WIDTH_RANGES` 命中外 `base + 该码点` 不被合并为单个 cluster
- [x] 2.3 新增快路径命中守卫：在专测文件内先于首次调用把 `Intl.Segmenter` 替换为调用计数包装器，断言 ASCII/CJK 文本不触发 `segment()`；复合文本触发并回退到 Segmenter
- [x] 2.4 断言 `displayWidth` 与 `wrapContentLine` 的 ASCII 快路径与既有路径结果一致（含窄宽度、`prefixWidth ≥ width`、制表符与非 ASCII 回退用例）
- [x] 2.5 确认既有 render/input 测试（`blocks`、`app-renderer`、`markdown`、`tool-message-renderers-*`、`footer*`、`composer`、`layout`）无需改动即通过

## 3. 基准复测

- [x] 3.1 用临时基准脚本复测大会话全量投影（32MB / 3372 记录会话，98/120/200 列各取中位数），记录优化前后耗时
- [x] 3.2 对同一会话断言优化前后投影输出 sha1 逐字节一致
- [x] 3.3 记录白名单回退占比（预期 <1% 记录）与命中时的耗时分布

## 4. 验证

- [x] 4.1 `npm run typecheck`
- [x] 4.2 `npm test`
- [x] 4.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.4 `openspec validate optimize-render-width-fast-path --strict`
- [x] 4.5 交互式手工验证：`/resume` 大会话恢复耗时、Ctrl+J 输入 emoji/中文、`@` 文件 mention 高亮、列宽变化与主题切换后的整屏重绘

## 5. 文档

- [x] 5.1 `docs/tui-architecture.md` 同步 grapheme/宽度快路径语义与保留的 Segmenter 回退边界
- [x] 5.2 `ROADMAP.md` 第 12 项标注 L1 已完成，并说明 L2/L3 另开 change
