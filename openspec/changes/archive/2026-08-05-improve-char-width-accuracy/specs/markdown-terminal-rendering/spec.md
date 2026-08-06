## ADDED Requirements

### Requirement: 表格列宽基于准确显示宽度对齐
系统 SHALL 使用统一的 grapheme 级终端显示宽度计算 pipe table 的列宽、单元格 padding、对齐与换行。宽字符、零宽字符、emoji 和变体选择符 SHALL 全部按 `character-width-determination` 能力定义的规则参与列宽计算（Ambiguous 字符一律按 1 列），保证渲染行的可见宽度与计算宽度一致，不产生边框错位。

#### Scenario: 宽字符与 emoji 参与列宽计算
- **WHEN** 表格 cell 包含 CJK 扩展 B 宽字符、ZWJ 家族 emoji 或旗帜 emoji
- **THEN** render 层 SHALL 按 2 列计算这些 cluster 的宽度并据此分配列宽、padding 和对齐
- **THEN** 表格每行渲染后的可见宽度 SHALL 落在分配的列宽内，边框 SHALL 保持对齐

#### Scenario: 零宽字符不破坏列宽
- **WHEN** 表格 cell 包含组合音标、变体选择符或零宽格式符
- **THEN** render 层 SHALL 将这些字符按 0 列计算，不额外撑大列宽或改变 padding

#### Scenario: VS16 与文本呈现符号宽度正确
- **WHEN** 表格 cell 包含带 VS16 的 emoji（如 `⚠️`）或无 VS16 的文本呈现符号（如 `♠`）
- **THEN** render 层 SHALL 分别按 2 列与 1 列计算，行可见宽度与列宽计算保持一致

#### Scenario: 换行不对齐不发生在 cluster 内部
- **WHEN** 表格 cell 内容在列宽内换行
- **THEN** 换行点 SHALL 落在 grapheme cluster 边界，不拆分 ZWJ 序列或旗帜 emoji
