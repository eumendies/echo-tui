# command-surface-ui-language Specification

## Purpose

定义 footer command surfaces 的共享视觉语言，包括颜色、焦点行、marker 和用户可见文案语言规则。
## Requirements
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
系统 SHALL 让 footer command surface 的内置用户可见文案以中文为主。操作、状态、空状态、加载状态、说明句子、section 标题和普通字段标签 SHALL 使用中文；按键名、slash command 名、文件路径、协议名、模型 id、API/config 字段名、provider/model/header/context/reasoning 等技术领域词和产品名 MAY 保留英文。系统 SHALL NOT 因现有 renderer 内部命名或历史文案而继续展示可自然翻译的非技术英文。

#### Scenario: 默认提示使用中文
- **WHEN** surface 没有由调用方提供 dismiss hint 或说明文案而使用 renderer 默认文案
- **THEN** 默认文案 SHALL 使用中文表达用户动作和状态
- **THEN** 默认文案 MAY 保留 `Enter`、`Esc`、`Tab`、`Space`、`MCP`、`API key`、`Base URL`、路径和命令名等英文技术词

#### Scenario: 内置动作和状态使用中文
- **WHEN** command surface 渲染新增、删除、保存、返回、关闭、加载中、未设置、空或已配置等内置动作或状态
- **THEN** 对应文案 SHALL 使用中文
- **THEN** surface SHALL NOT 展示 `add`、`delete`、`save changes`、`loading`、`not set`、`empty` 等可自然翻译的非技术英文作为内置文案

#### Scenario: 混合文案保持语义一致
- **WHEN** surface 文案同时包含中文句子和英文技术名词
- **THEN** 中文 SHALL 表达动作、状态和解释
- **THEN** 英文 SHALL 仅用于按键、命令、路径、协议、模型、配置/API 字段、技术领域词或用户已有输入

#### Scenario: 用户输入和技术标识不被翻译
- **WHEN** surface 展示模型 API id、provider preset 名、产品名、协议名、header name、配置路径或用户输入的名称
- **THEN** 系统 SHALL 保留其原始文本
- **THEN** 中文化 SHALL NOT 改写这些标识或影响其持久化值

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

