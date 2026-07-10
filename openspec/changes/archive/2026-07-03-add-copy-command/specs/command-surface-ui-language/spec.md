## ADDED Requirements

### Requirement: copy surface 遵循 footer 两栏视觉语言
copy command surface SHALL 遵循既有 footer command surface 视觉语言，使用共享 theme palette、边框、焦点标记、选择 marker、中文文案和高度预算。copy surface SHALL 使用两栏布局表达消息列表与全文预览，并 SHALL 在窄终端或有限 footer 高度下安全裁剪内容。

#### Scenario: copy surface 使用共享视觉元素
- **WHEN** footer 渲染 copy command surface
- **THEN** copy surface SHALL 使用共享 footer theme palette 表达边框、标题、焦点、active row、弱化文本和状态提示
- **THEN** 当前聚焦消息 SHALL 使用 `▌`、active 背景或等价高亮表达焦点
- **THEN** 已选中和未选中消息 SHALL 使用 `●/○` 表达选择状态

#### Scenario: copy surface 使用中文用户文案
- **WHEN** copy surface 展示标题、空状态、操作提示、失败提示或成功/状态说明
- **THEN** 可自然翻译的用户可见文案 SHALL 使用中文
- **THEN** `Enter`、`Esc`、`Space`、`Tab`、`User`、`Assistant` 和 `/copy` 等按键、角色或命令标识 MAY 保留英文

#### Scenario: copy surface 遵守渲染预算
- **WHEN** copy surface 在窄终端或有限 footer 高度下渲染
- **THEN** 每一行 SHALL 遵守 safe render width
- **THEN** 左侧消息列表 SHALL 使用窗口化或裁剪避免超出高度预算
- **THEN** 右侧全文预览 SHALL 裁剪或窗口化显示，且 SHALL NOT 破坏 footer 重绘区域
