## ADDED Requirements

### Requirement: 含制表符文本的稳定终端投影
系统 SHALL 在渲染 composer 和用户消息时，将制表符投影为与其当前可见列一致的空格，并使用同一投影计算显示宽度、自动换行、填充和光标列位置。系统 SHALL 保留 composer state 与 transcript record 中的原始制表符。

#### Scenario: composer 显示含制表符的粘贴内容
- **WHEN** 用户向 composer 粘贴以制表符缩进的多行文本
- **THEN** boxed composer 的左右边框 SHALL 保持在每一可见行的预期列
- **THEN** 可见光标 SHALL 位于展开制表符后的正确列
- **THEN** composer state SHALL 继续包含原始制表符

#### Scenario: 已提交用户消息显示含制表符内容
- **WHEN** 用户提交包含制表符的多行文本
- **THEN** 每个用户消息可见行 SHALL 保持完整的前缀和背景填充
- **THEN** 终端 SHALL NOT 因未计算的制表位产生额外物理换行
- **THEN** transcript record SHALL 继续包含原始制表符
