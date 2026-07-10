## MODIFIED Requirements

### Requirement: footer command surface 共享颜色语言
系统 SHALL 为 footer command surfaces 使用共享 semantic theme palette 和 active row 样式。各 command surface renderer SHALL 复用统一的 accent、accentDeep、accentStrong、frame、muted、success、warning、danger、selectionBackground 和 code background/foreground 语义；默认 theme SHALL 保持现有 cyan 风格，但 renderer SHALL NOT 直接依赖固定 cyan 色值或各自定义冲突的 active 背景。

#### Scenario: surface 使用共享 theme palette
- **WHEN** footer 渲染 command surface、choice surface、file picker、resume、config、mcp、skills、scale 或 context 面板
- **THEN** 该 surface SHALL 使用共享 footer theme palette 表达边框、标题、焦点条、active 文本和弱化文本
- **THEN** 同类视觉元素 SHALL 在不同 surface 中呈现一致或等价的颜色语义
- **THEN** 默认 theme 下这些元素 SHALL 保持现有 cyan 风格

#### Scenario: active row 背景一致
- **WHEN** command surface 中存在当前聚焦行或当前选中行
- **THEN** 该行 SHALL 使用共享 selectionBackground 或等价 theme 背景
- **THEN** active 文本 SHALL 使用共享 accentStrong 或等价 theme 高亮文本
