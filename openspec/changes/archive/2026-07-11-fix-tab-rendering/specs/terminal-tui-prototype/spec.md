## ADDED Requirements

### Requirement: composer 与用户消息的制表符布局一致性
系统 SHALL 在 composer 和用户消息的终端投影中，以同一制表位规则处理制表符，保证渲染结果的可见宽度与终端实际输出宽度一致。

#### Scenario: 含制表符内容在 footer 和 transcript 间流转
- **WHEN** 用户在 composer 中输入或粘贴包含制表符的文本并提交
- **THEN** composer 的边框、自动换行和光标定位 SHALL 不被制表符破坏
- **THEN** 提交后的用户消息前缀、背景和行尾填充 SHALL 不被制表符破坏
