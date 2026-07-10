# footer-theme-config Specification

## Purpose
定义用户级 render theme 配置如何控制 footer、transcript block、banner、Markdown、syntax highlight 和 tool block 的可见样式，并保持交互、持久化和事实语义不变。
## Requirements
### Requirement: 独立 footer theme 配置文件
系统 SHALL 从独立用户级 `theme.json` 文件读取 TUI render theme 配置。该文件 SHALL 与 `~/.echo/config.json` 分离，且 theme 配置错误 SHALL NOT 影响 LLM、tool 或 MCP 配置读取。系统 SHALL NOT 从 `~/.echo/config.json` 的 `tui.syntaxHighlight` 或其他旧 TUI 展示配置读取颜色配置。

#### Scenario: 缺失 theme 文件使用默认 theme
- **WHEN** 用户级 `theme.json` 不存在
- **THEN** 系统 SHALL 使用内置默认 render theme
- **THEN** TUI SHALL 正常启动并保持当前默认 footer、transcript block、banner、Markdown 和 syntax highlight 视觉

#### Scenario: theme 文件不影响 LLM 配置
- **WHEN** `theme.json` 缺失、不是有效 JSON 或包含无效字段
- **THEN** 系统 SHALL NOT 因 theme 配置追加 transcript error
- **THEN** 系统 SHALL NOT 改变 LLM 配置读取、provider 选择、tool 配置或 MCP 配置语义

#### Scenario: theme 在 app 创建时读取一次
- **WHEN** TUI app 创建
- **THEN** 系统 SHALL 读取用户级 theme 配置并归一化为当前进程的 render theme
- **THEN** footer streaming render、transcript append、pending preview、局部 redraw、final render 和 destructive resize replay SHALL 复用该 render theme，而不是在渲染热路径重复读取文件

#### Scenario: 旧 syntax highlight 配置不再读取
- **WHEN** `~/.echo/config.json` 中存在 `tui.syntaxHighlight`
- **THEN** 系统 SHALL NOT 读取该配置作为语法高亮主题
- **THEN** fenced code block 语法高亮 SHALL 只使用当前 `theme.json` 归一化后的 render theme

### Requirement: footer semantic theme token
系统 SHALL 使用 semantic theme token 表达 TUI 可配置颜色，而不是让 renderer 直接依赖固定 cyan 命名。默认 token 值 SHALL 保持当前 footer、transcript block、banner、Markdown 和 syntax highlight 的默认视觉。

#### Scenario: 默认 token 覆盖 footer 共享视觉语义
- **WHEN** 默认 render theme 生效
- **THEN** theme SHALL 为 footer 提供 accent、accentStrong、accentDeep、frame、text、muted、success、warning、danger、selectionBackground、codeBackground 和 codeForeground 或等价语义 token
- **THEN** footer renderer SHALL 使用这些 token 表达标题、边框、焦点条、active 文本、弱化文本、状态 marker、警告、错误、active row 和 code-like 内容

#### Scenario: 默认 token 覆盖 block 和 Markdown 视觉语义
- **WHEN** 默认 render theme 生效
- **THEN** theme SHALL 为 blocks、Markdown 和 syntax highlight 提供 banner、user、assistant、pending、error、notice、reasoning、shell、tool、heading、list marker、blockquote、rule、table、inline code 和 syntax token 或等价语义 token
- **THEN** render 层 SHALL 使用这些 token 表达 transcript block、pending preview、banner、assistant Markdown 和 fenced code block 的可配置视觉

#### Scenario: 用户覆盖部分 token
- **WHEN** `theme.json` 只配置部分 render theme token
- **THEN** 已配置且有效的 token SHALL 覆盖默认值
- **THEN** 未配置 token SHALL 继续使用默认 render theme 值

#### Scenario: 局部无效 token 回退默认值
- **WHEN** `theme.json` 中某个 render theme token 的颜色格式无效或超出允许范围
- **THEN** 系统 SHALL 忽略该 token
- **THEN** 该 token SHALL 使用默认 render theme 值
- **THEN** 其他有效 token SHALL 仍然生效

#### Scenario: theme color 不支持 raw sgr
- **WHEN** `theme.json` 中某个颜色使用 `{ "sgr": number }`
- **THEN** 系统 SHALL 将该颜色视为无效 token
- **THEN** 该 token SHALL 使用默认 render theme 值

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

### Requirement: footer theme 接入范围
系统 SHALL 将 render theme 接入 footer、transcript block、banner、pending preview、assistant Markdown、syntax highlight 和非固定语义的 tool block 视觉。footer 区域包括普通 composer/status line、slash suggestion、command surfaces、choice、file picker、resume、config、mcp、skills、scale、context 和 diff footer surface。

#### Scenario: 普通 composer 使用 theme
- **WHEN** 普通输入态 footer 渲染 composer、status line 或 slash suggestion
- **THEN** composer 边框、status line 强调文本、mode/status marker、context usage、slash suggestion active 行和弱化文案 SHALL 使用当前 footer theme token

#### Scenario: command surface 使用 theme
- **WHEN** footer 渲染任意 command surface、choice surface、file picker、resume、config、mcp、skills、scale 或 context 面板
- **THEN** surface 边框、标题、焦点条、active 背景、active 文本、状态 marker、警告、错误和弱化文本 SHALL 使用当前 footer theme token

#### Scenario: diff footer surface 使用 theme
- **WHEN** footer 渲染 diff surface
- **THEN** diff 面板标题、文件列表、焦点状态、统计数字、gutter 和弱化文本 SHALL 使用当前 footer theme token
- **THEN** diff added/removed 行背景 MAY 继续使用专用新增/删除语义颜色，但这些颜色 SHALL 来自 footer theme 或默认 theme，而不是散落的硬编码值

#### Scenario: transcript 和 Markdown 使用 theme
- **WHEN** 用户配置 render theme
- **THEN** transcript block、assistant Markdown 正文、代码块 syntax highlight、启动 banner 和非固定语义 tool block 正文 SHALL 使用当前 render theme
- **THEN** 用户 SHALL NOT 通过旧 `tui.syntaxHighlight` 配置代码块高亮主题

#### Scenario: 固定事实语义色不受 theme 影响
- **WHEN** apply_patch tool result 渲染 added 或 removed 行
- **THEN** added/removed 背景色 SHALL 使用代码内固定语义色
- **THEN** theme override SHALL NOT 改变这些 added/removed 事实语义色

### Requirement: footer theme 不改变交互和持久化语义
render theme SHALL 只影响可见颜色和强调样式，不得改变输入事件处理、命令状态机、transcript 记录、session 持久化、配置保存、tool result 原文或 provider 请求。

#### Scenario: theme override 不改变命令行为
- **WHEN** 用户配置自定义 render theme
- **AND** 用户在任意 footer surface 中按 Up、Down、Left、Right、Tab、Space、Enter 或 Esc
- **THEN** 系统 SHALL 保持该 surface 原有的选择、切换、确认、保存、取消、滚动或关闭语义
- **THEN** 系统 SHALL NOT 因 theme 渲染追加 transcript record 或修改 command data schema

#### Scenario: theme override 保持终端布局约束
- **WHEN** footer、transcript block、pending preview、Markdown 或 tool block 使用自定义 theme 渲染
- **THEN** 每一行 SHALL 继续遵守 safe render width
- **THEN** renderer SHALL 继续遵守现有高度预算、窗口化、裁剪、局部 redraw 和 destructive resize recovery 约束

#### Scenario: theme override 不改变持久化事实
- **WHEN** transcript records、tool results 或 session 被保存
- **THEN** theme SHALL NOT 写入 transcript record、tool result text 或 session content records
- **THEN** 恢复 session 时 SHALL 使用当前进程 theme 重新投影可见内容

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

