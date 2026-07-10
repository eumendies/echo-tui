## MODIFIED Requirements

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
