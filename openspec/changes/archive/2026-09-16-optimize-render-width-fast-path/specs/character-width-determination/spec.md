## MODIFIED Requirements

### Requirement: display width API 稳定语义
`charWidth`、`displayWidth` 与 `splitGraphemes` SHALL 保持既有对外签名与调用语义。`displayWidth` SHALL 先剥离 ANSI 序列，再按 grapheme cluster 求和，换行符重置列计数，制表符按当前列移动到下一制表位；对不含 ANSI 序列、制表符、换行符与任何非 ASCII 码点的文本，`displayWidth` MAY 直接以文本长度作为等价值返回。`splitGraphemes` SHALL 在需要时复用同一 `Intl.Segmenter` 实例，SHALL NOT 逐次构造。

#### Scenario: ANSI 与制表符不影响宽度
- **WHEN** 输入含 ANSI 颜色序列、制表符或换行的文本
- **THEN** `displayWidth` SHALL 忽略 ANSI 序列并按制表位展开制表符
- **THEN** 换行后 SHALL 从 0 列重新累计

#### Scenario: 纯 ASCII 行按长度等值返回
- **WHEN** 输入不含 ANSI 序列、制表符、换行符与非 ASCII 码点
- **THEN** `displayWidth` SHALL 返回与按 grapheme cluster 求和一致的宽度
- **THEN** 一旦出现 ESC、制表符、换行或非 ASCII 码点，SHALL 回到剥离 ANSI 并按 cluster 求和的既有路径

#### Scenario: Segmenter 单例化
- **WHEN** 高频 footer 重绘反复调用 `splitGraphemes` 且文本需要 `Intl.Segmenter` 参与切分
- **THEN** 系统 SHALL 复用同一 `Intl.Segmenter` 实例，不逐次构造

## ADDED Requirements

### Requirement: grapheme 切分的等价快路径
`splitGraphemes` SHALL 在文本不包含任何可能改变 grapheme cluster 边界的码点时跳过 `Intl.Segmenter`，直接以码点为单位切分。判据 SHALL 采用保守策略：宁可回退 `Intl.Segmenter`，SHALL NOT 漏判。判据 SHALL 至少把零宽/组合字符区间（`ZERO_WIDTH_RANGES`）命中码点、SpacingMark 与 Prepend 码点、regional indicator、emoji modifier 以及 Hangul conjoining jamo（含 L/V/T 及其扩展区）视为需要 `Intl.Segmenter`。快路径与 `Intl.Segmenter` 路径的切分结果 SHALL 逐元素一致，SHALL NOT 改变任何渲染输出、换行点或宽度结果。

#### Scenario: 简单文本不经过 Segmenter
- **WHEN** 输入只含 ASCII、拉丁、常用标点符号、CJK、假名或谚文音节，且不含零宽/组合字符等边界码点
- **THEN** `splitGraphemes` SHALL 按码点切分并返回等价结果
- **THEN** 该次调用 SHALL NOT 触及 `Intl.Segmenter`

#### Scenario: 复合 cluster 回退 Segmenter
- **WHEN** 输入含组合音标、VS15/VS16、keycap、ZWJ 序列、旗帜 emoji、emoji modifier、SpacingMark、Prepend 或 Hangul jamo
- **THEN** `splitGraphemes` SHALL 回退 `Intl.Segmenter`
- **THEN** 复合字符序列 SHALL NOT 被拆分为多个元素

#### Scenario: 宽度与换行保持既有结果
- **WHEN** 同一文本分别以快路径与 `Intl.Segmenter` 路径计算宽度并按宽度换行
- **THEN** 宽度结果 SHALL 相等
- **THEN** 换行点与逐行内容 SHALL 一致
