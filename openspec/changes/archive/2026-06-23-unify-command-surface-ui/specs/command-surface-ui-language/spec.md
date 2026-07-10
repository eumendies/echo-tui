## ADDED Requirements

### Requirement: footer command surface 共享颜色语言
系统 SHALL 为 footer command surfaces 使用共享 cyan palette 和 active row 样式。各 command surface renderer SHALL 复用统一的 cyan deep、cyan、cyan bright、frame、muted、success、warn、danger 和 active background 语义，而不是各自定义冲突的 cyan 色值或 active 背景。

#### Scenario: surface 使用共享 cyan palette
- **WHEN** footer 渲染 command surface、choice surface、file picker、resume、config、mcp、skills、scale 或 context 面板
- **THEN** 该 surface SHALL 使用共享 footer cyan palette 表达边框、标题、焦点条、active 文本和弱化文本
- **THEN** 同类视觉元素 SHALL 在不同 surface 中呈现一致或等价的颜色语义

#### Scenario: active row 背景一致
- **WHEN** command surface 中存在当前聚焦行或当前选中行
- **THEN** 该行 SHALL 使用共享 active background 或等价深色 cyan 背景
- **THEN** active 文本 SHALL 使用共享 cyan bright 或等价高亮 cyan 文本

### Requirement: footer command surface 焦点语言
系统 SHALL 使用项目既有粗竖条 `▌` 作为 footer command surface 的焦点标记。`▌` SHALL 表示当前键盘焦点或当前 active row；系统 SHALL NOT 使用 `▸`、`›`、inverse-only 或仅颜色变化作为同类列表行的主要焦点标记。

#### Scenario: 列表当前项使用粗竖条
- **WHEN** footer command surface 渲染可上下移动的当前项
- **THEN** 当前项 SHALL 在行首或等价起始位置显示 `▌`
- **THEN** 非当前项 SHALL NOT 显示 `▌`

#### Scenario: resume 不使用箭头表达焦点
- **WHEN** `/resume` 历史恢复面板渲染左侧 session 当前项或当前 focus panel
- **THEN** 面板 SHALL 使用 `▌`、active 背景和 cyan 高亮文本表达焦点
- **THEN** 面板 SHALL NOT 使用 `▸`、`·` 或 inverse 作为主要焦点语言

#### Scenario: generic select 不使用旧箭头表达焦点
- **WHEN** 普通 select 或 checkbox command surface 渲染当前项
- **THEN** 当前项 SHALL 使用 `▌` 作为焦点标记
- **THEN** 当前项 SHALL NOT 使用 `›` 作为焦点标记

### Requirement: footer command surface marker 语言
系统 SHALL 使用 `●/○` 表达 footer command surface 中 enabled/disabled、checked/unchecked、已选择/未选择等有 toggle、boolean 或明确状态语义的 marker。没有 toggle 语义的普通 select、session 列表和 slash suggestion SHALL 只使用 `▌`、active 背景和高亮文本表达当前焦点，不得为了统一而强行添加 `●/○`。不可选项 MAY 使用弱化文本或 `-`，但 SHALL NOT 与可选项的 `●/○` 状态混淆。

#### Scenario: checkbox 使用圆点 marker
- **WHEN** checkbox command surface 渲染 checked option
- **THEN** checked option SHALL 使用 `●` 表达 checked 状态
- **WHEN** checkbox command surface 渲染 unchecked option
- **THEN** unchecked option SHALL 使用 `○` 表达 unchecked 状态
- **THEN** checkbox command surface SHALL NOT 使用 `[x]` 或 `[ ]` 表达 checked 状态

#### Scenario: 普通 select 不强加圆点 marker
- **WHEN** 普通 select command surface 只表达当前键盘焦点且 option 本身没有 toggle、checked、enabled 或已选择状态
- **THEN** 当前 option SHALL 使用 `▌`、active 背景和高亮文本表达焦点
- **THEN** 当前 option SHALL NOT 被强行添加 `●` marker
- **THEN** 非当前 option SHALL NOT 被强行添加 `○` marker

#### Scenario: resume session 不强加圆点 marker
- **WHEN** `/resume` 面板渲染当前 session
- **THEN** 当前 session SHALL 使用 `▌`、active 背景和高亮文本表达当前焦点
- **THEN** 当前 session SHALL NOT 被强行添加 `●` marker
- **WHEN** `/resume` 面板渲染非当前 session
- **THEN** 非当前 session SHALL NOT 被强行添加 `○` marker

### Requirement: footer command surface 文案语言
系统 SHALL 让 footer command surface 的默认用户可见文案以中文为主。操作提示、空状态、加载状态和说明句子 SHALL 使用中文；按键名、slash command 名、文件路径、协议名、模型 id、API 字段名和产品名 MAY 保留英文。

#### Scenario: 默认提示使用中文
- **WHEN** surface 没有由调用方提供 dismiss hint 或说明文案而使用 renderer 默认文案
- **THEN** 默认文案 SHALL 使用中文表达用户动作和状态
- **THEN** 默认文案 MAY 保留 `Enter`、`Esc`、`Tab`、`Space`、`MCP`、`API key`、`Base URL`、路径和命令名等英文技术词

#### Scenario: 混合文案保持语义一致
- **WHEN** surface 文案同时包含中文句子和英文技术名词
- **THEN** 中文 SHALL 表达动作、状态和解释
- **THEN** 英文 SHALL 仅用于按键、命令、路径、协议、模型、配置字段或用户已有输入

### Requirement: footer UI 统一不改变交互语义
统一 UI 语言 SHALL 只改变可见样式和用户可见默认文案，不得改变 command surface 的输入事件、session data、业务行为、transcript 记录或持久化语义。

#### Scenario: 样式迁移不改变命令行为
- **WHEN** 用户在任意 command surface 中按下原本支持的 Up、Down、Left、Right、Tab、Space、Enter 或 Esc
- **THEN** 系统 SHALL 保持该 surface 原有的选择、切换、确认、保存、取消或滚动语义
- **THEN** 系统 SHALL NOT 因 UI marker 或颜色迁移追加 transcript record 或修改 command data schema

#### Scenario: 样式迁移保持终端约束
- **WHEN** command surface 在窄终端或有限 footer 高度下渲染
- **THEN** 每一行 SHALL 继续遵守 safe render width
- **THEN** surface SHALL 继续遵守现有高度预算、窗口化和裁剪策略
