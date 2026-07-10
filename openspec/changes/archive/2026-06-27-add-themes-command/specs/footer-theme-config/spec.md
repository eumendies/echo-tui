## ADDED Requirements

### Requirement: render theme base selection
系统 SHALL 支持在用户级 `theme.json` 根字段 `theme` 中声明内置 render theme base id。系统 SHALL 先解析该 base theme，再将同一 `theme.json` 中的 `footer`、`blocks`、`markdown` 和 `syntax` token override 合并到 base 上。缺失 `theme` 字段 SHALL 等价于使用 `default` base。

#### Scenario: theme root field selects builtin base
- **WHEN** `theme.json` 包含 `"theme": "amber"` 且只配置部分 token override
- **THEN** 系统 SHALL 以 `amber` 内置 theme 作为 base
- **THEN** 已配置且有效的 token override SHALL 覆盖 `amber` base
- **THEN** 未配置 token SHALL 继续使用 `amber` base 的对应值

#### Scenario: missing theme root field keeps default base
- **WHEN** `theme.json` 不包含根字段 `theme` 但包含有效 token override
- **THEN** 系统 SHALL 以代码内默认 render theme 作为 base
- **THEN** 已配置且有效的 token override SHALL 覆盖默认 base
- **THEN** 未配置 token SHALL 继续使用默认 base 的对应值

#### Scenario: invalid theme root field falls back to default base
- **WHEN** `theme.json` 包含无效、未知或不可读取的根字段 `theme`
- **THEN** 系统 SHALL 使用代码内默认 render theme 作为 base
- **THEN** 系统 SHALL 继续合并同一文件中有效的 token override
- **THEN** 系统 SHALL NOT 因无效 base id 阻断 TUI 启动

#### Scenario: selecting builtin theme preserves overrides
- **WHEN** 现有 `theme.json` 包含 `footer`、`blocks`、`markdown` 或 `syntax` 自定义 override
- **AND** `/themes` 命令成功保存新的内置 theme id
- **THEN** 系统 SHALL 只更新根字段 `theme`
- **THEN** 系统 SHALL 保留已有自定义 override 字段
- **THEN** 下一次读取 `theme.json` SHALL 使用新的 base 加保留的 override 归一化 render theme

## MODIFIED Requirements

### Requirement: 内置 footer theme JSON
系统 SHALL 随 TUI 安装包发布一组内置 render theme JSON 文件，且默认 render theme SHALL 由代码内常量表达，以避免默认启动路径读取内置 JSON。内置 JSON SHALL 覆盖 footer、blocks、Markdown 和 syntax highlight 的可配置 token。

#### Scenario: 内置 theme 随构建产物发布
- **WHEN** 项目运行构建流程
- **THEN** 系统 SHALL 将源码中的内置 theme JSON 复制到 `dist` 下的运行时代码可读取位置
- **THEN** npm package 的 `dist/src` 文件范围 SHALL 包含这些内置 theme JSON

#### Scenario: 默认 theme 不读取内置 JSON
- **WHEN** 用户级 `theme.json` 不存在或不可读取
- **THEN** 系统 SHALL 使用代码内默认 render theme
- **THEN** 系统 SHALL NOT 为默认 theme 读取内置 `default` theme JSON

#### Scenario: themes 命令可列举内置 theme
- **WHEN** `/themes` 命令需要展示可切换 theme
- **THEN** theme 配置模块 SHALL 提供列举内置 theme metadata 的 API
- **THEN** theme 配置模块 SHALL 提供按内置 theme id 读取完整 render theme 的 API
- **THEN** metadata 列表 SHALL 至少包含代码内默认 theme 的 `default` 项
- **THEN** 无效 theme id 或坏 theme 文件 SHALL NOT 阻断 TUI 启动
