# character-width-determination Specification

## Purpose

定义终端显示宽度判定的稳定语义：以静态 Unicode 数据表和 grapheme cluster 级决策计算 `charWidth`/`displayWidth`/`splitGraphemes` 的行为，保证渲染层所有路径的宽度口径一致。
## Requirements
### Requirement: 静态 Unicode 宽度数据表
系统 SHALL 以静态数据模块承载终端显示宽度判定所需的 Unicode 区间表，不依赖构建期生成脚本或运行时第三方依赖。数据表 SHALL 包含宽字符区间（East Asian W/F）、零宽/组合字符区间（含 Grapheme_Extend、零宽格式符、谚文中声）、Emoji_Presentation 区间和 Emoji base 区间，全部为排序不重叠的闭区间列表，并在文件头注明 Unicode 数据版本与出处。

#### Scenario: 宽字符覆盖扩展平面
- **WHEN** 输入 CJK 扩展 B 及以后的宽字符（如 `U+20000` 起）
- **THEN** 系统 SHALL 将其显示宽度判定为 2

#### Scenario: 零宽与组合字符不占列
- **WHEN** 输入组合音标、变体选择符、ZWSP、ZWNJ、ZWJ、BOM、软连字符或谚文中声等零宽/组合字符
- **THEN** 系统 SHALL 将其显示宽度判定为 0

#### Scenario: Ambiguous 字符固定按 1 列
- **WHEN** 输入 East Asian Ambiguous 字符（如希腊字母、`±`、`°`、框线 `│─┼`、块元素 `▌`）
- **THEN** 系统 SHALL 一律按 1 列计算，不提供按 2 列的配置开关
- **AND** 框线等布局字符的宽度计算 SHALL 与终端实际渲染保持一致，避免边框错位

### Requirement: grapheme 级宽度决策
系统 SHALL 以 grapheme cluster 为单位判定终端显示宽度，并优先处理变体选择符与 emoji 组合语义：含 VS15 的 cluster 按文本呈现计算；含 VS16 且含 Emoji base 的 cluster 按 2 列；含 ZWJ 且含 Emoji base 的 cluster 按 2 列；双 regional indicator 按 2 列；含 Emoji_Presentation 码点且无 VS15 的 cluster 按 2 列；其余 cluster 按码点求和（宽 2 / 零宽 0 / 其余 1，Ambiguous 一律按 1）。

#### Scenario: 文本呈现符号保持 1 列
- **WHEN** 输入无 VS16 的 `♠`、`♪`、`⌘`、`⚠`、`✓` 或 `✕`
- **THEN** 系统 SHALL 将其显示宽度判定为 1

#### Scenario: VS16 强制 emoji 呈现
- **WHEN** 输入带 VS16 的 `⚠️`、`✔️`、`©️` 或 `1️⃣`
- **THEN** 系统 SHALL 将其显示宽度判定为 2
- **AND** 输入不带 Emoji 属性的字符加 VS16（如 `✓️`、`✕️`）
- **THEN** 系统 SHALL 仍按文本呈现宽度判定为 1

#### Scenario: ZWJ 序列与旗帜按单字形
- **WHEN** 输入 ZWJ 家族 emoji（如 `👨‍👩‍👧‍👦`）或双 regional indicator 旗帜（如 `🇨🇳`）
- **THEN** 系统 SHALL 将整个 cluster 的显示宽度判定为 2

#### Scenario: 组合字符序列按 base 宽度求和
- **WHEN** 输入 `e` 加组合音标或谚文 jamo 序列
- **THEN** 系统 SHALL 按 base 字符宽度与零宽组件求和，不被拆分或高估

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

