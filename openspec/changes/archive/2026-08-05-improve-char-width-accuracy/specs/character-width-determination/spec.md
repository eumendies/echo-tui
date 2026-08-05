## ADDED Requirements

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
`charWidth`、`displayWidth` 与 `splitGraphemes` SHALL 保持既有对外签名与调用语义。`displayWidth` SHALL 先剥离 ANSI 序列，再按 grapheme cluster 求和，换行符重置列计数，制表符按当前列移动到下一制表位。`splitGraphemes` SHALL 缓存 `Intl.Segmenter` 实例，避免重复构造。

#### Scenario: ANSI 与制表符不影响宽度
- **WHEN** 输入含 ANSI 颜色序列、制表符或换行的文本
- **THEN** `displayWidth` SHALL 忽略 ANSI 序列并按制表位展开制表符
- **THEN** 换行后 SHALL 从 0 列重新累计

#### Scenario: Segmenter 单例化
- **WHEN** 高频 footer 重绘反复调用 `splitGraphemes`
- **THEN** 系统 SHALL 复用同一 `Intl.Segmenter` 实例，不逐次构造
