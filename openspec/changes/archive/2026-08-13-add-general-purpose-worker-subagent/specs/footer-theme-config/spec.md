## ADDED Requirements

### Requirement: blocks token 集合提供子 Agent 轨道专属色
系统 SHALL在blocks主题token集合中提供`subagentRail`语义token，表达子Agent过程块最外层marker、连续rail和Agent标题的专属颜色，且该token SHALL与顶层`tool`语义色解耦。默认render theme SHALL在代码内常量提供默认值；全部内置theme JSON SHALL提供各自取值。用户`theme.json` SHALL按现有blocks token规则覆盖该token，无效值 SHALL回退base theme默认值。

#### Scenario: 默认 theme 在代码内提供专属色
- **WHEN** 用户级`theme.json`不存在或未配置`blocks.colors.subagentRail`
- **THEN** 系统 SHALL使用代码内默认render theme的`subagentRail`值
- **THEN** 系统 SHALL NOT为默认theme读取内置JSON

#### Scenario: 内置 theme 提供专属色
- **WHEN** 构建流程发布内置theme JSON
- **THEN** 全部内置theme SHALL包含`subagentRail` token且取值来自各theme自身调色方案

#### Scenario: 用户覆盖与无效回退
- **WHEN** `theme.json`配置了有效的`blocks.colors.subagentRail`
- **THEN** 系统 SHALL按现有blocks token规则覆盖base theme的对应值
- **WHEN** 该token颜色格式无效
- **THEN** 系统 SHALL忽略该token并回退base theme默认值
