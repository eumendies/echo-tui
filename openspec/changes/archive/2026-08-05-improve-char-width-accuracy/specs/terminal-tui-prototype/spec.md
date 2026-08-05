## ADDED Requirements

### Requirement: composer 以 grapheme cluster 为编辑单元
系统 SHALL 将 composer 的编辑模型与渲染模型统一到 grapheme cluster 粒度。composer 的字符数组元素 SHALL 是 grapheme cluster；光标移动、退格、删除、行内裁剪与自动换行 SHALL 都以 grapheme cluster 边界为准，ZWJ 序列、旗帜 emoji、keycap 和组合字符序列不得被拆散。`@` 文件 mention 的解析索引 SHALL 与 grapheme 数组下标保持一致，高亮范围不被 emoji 或组合序列错位。

#### Scenario: 光标跨过复合 emoji 边界
- **WHEN** composer 文本包含 ZWJ 家族 emoji、旗帜 emoji 或组合字符序列，且用户按左右方向键或退格
- **THEN** 光标 SHALL 按 grapheme cluster 边界移动，一次移动越过整个 cluster
- **THEN** 退格 SHALL 一次性删除整个 cluster，不残留半个 emoji 或孤立变体选择符

#### Scenario: composer 自动换行不拆分 cluster
- **WHEN** composer 文本包含复合 emoji 且当前行接近安全宽度
- **THEN** 自动换行点 SHALL 落在 grapheme cluster 边界，复合 emoji 整体换到下一行
- **THEN** 光标所在行列 SHALL 与该换行规则一致

#### Scenario: @ mention 高亮索引与 grapheme 对齐
- **WHEN** composer 文本包含 `@路径` mention，且 mention 前后存在 emoji 或组合字符
- **THEN** mention 高亮范围 SHALL 与 grapheme 数组下标一致，不因码点/字素计数差异错位

### Requirement: 消息块渲染的 grapheme 一致宽度
用户消息、本地提示、错误块等基于 `renderSymbolMessage` 的整行背景补齐与截断 SHALL 与 `displayWidth` 使用同一 grapheme 切分口径，避免同一文本在不同函数中宽度不一致导致灰底截断或边框错位。

#### Scenario: 复合 emoji 在消息块中宽度一致
- **WHEN** 用户消息或本地提示包含 ZWJ 家族 emoji、旗帜或 keycap
- **THEN** 换行、行尾 padding 与整行背景补齐 SHALL 全部按该 cluster 的同一显示宽度计算
- **THEN** 渲染结果 SHALL 不超过 safe render width，且不出现半截 emoji 或多余 padding
