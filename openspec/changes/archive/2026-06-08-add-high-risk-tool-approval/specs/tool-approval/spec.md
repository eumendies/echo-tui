## ADDED Requirements

### Requirement: 工具授权展示风险详情
工具授权 UI SHALL 支持展示风险分类提供的标题、说明、风险原因和调用预览。该展示 SHALL 复用现有 choice surface 和 `Allow once` / `Deny` 选项，不引入新的全屏 UI 或第三方 TUI 库。

#### Scenario: 显示高危 bash 授权详情
- **WHEN** 高危 bash tool call 需要用户授权
- **THEN** choice surface SHALL 显示该授权请求的标题
- **THEN** choice surface SHALL 显示 bash command 预览
- **THEN** choice surface SHALL 显示至少一个风险原因
- **THEN** choice surface SHALL 显示 `Allow once` 和 `Deny` 选项

#### Scenario: 保持 apply_patch 授权简洁
- **WHEN** `apply_patch` 授权请求没有额外风险展示信息
- **THEN** choice surface SHALL 继续显示工具名授权标题和 `Allow once` / `Deny` 选项
- **THEN** 系统 SHALL NOT 强制为 apply_patch 生成冗长的风险说明

#### Scenario: 拒绝授权保留结构化决策
- **WHEN** 用户在高危工具授权 UI 中选择 `Deny` 或按下 Esc
- **THEN** 系统 SHALL 继续使用现有拒绝授权决策表示该选择
- **THEN** agent loop runtime SHALL 根据该决策跳过原始 tool call 执行
