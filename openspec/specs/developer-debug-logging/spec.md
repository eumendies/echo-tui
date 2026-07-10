# developer-debug-logging Specification

## Purpose
定义 `echo_tui` 开发者 debug 模式的启用方式、结构化日志、短提示、旁路隔离和敏感信息保护要求，帮助开发者调试 assistant turn、provider 请求、工具执行和压缩流程，同时保持普通用户启动体验不变。

## Requirements

### Requirement: 开发者 debug 模式启用
系统 SHALL 支持一个默认关闭的开发者 debug 模式。该模式 SHALL 只能通过开发者启动路径或显式 debug 环境变量启用，普通用户安装后的 `echo-tui` 启动 SHALL NOT 默认启用 debug。

#### Scenario: 默认启动不启用 debug
- **WHEN** 用户或开发者在没有设置 debug 环境变量的情况下启动 TUI
- **THEN** 系统 SHALL 不创建 debug 日志 writer
- **THEN** 系统 SHALL 不写入 debug 日志文件
- **THEN** 系统 SHALL 保持既有 transcript、provider request、tool execution 和渲染行为

#### Scenario: debug 环境变量启用 debug
- **WHEN** 进程启动时存在有效 debug 环境变量
- **THEN** 系统 SHALL 创建 debug 日志上下文
- **THEN** 系统 SHALL 为本次进程生成或解析 debug 日志路径
- **THEN** 后续关键流程事件 SHALL 写入该 debug 日志

#### Scenario: 用户 CLI 帮助不暴露 debug 参数
- **WHEN** 用户运行 `echo-tui --help`
- **THEN** 帮助内容 SHALL NOT 要求列出 debug 模式参数
- **THEN** 系统 SHALL 继续只展示普通用户需要的 CLI 用法

### Requirement: debug 日志旁路隔离
Debug 日志 SHALL 作为内部旁路观察数据写入文件。Debug 写入 SHALL NOT 修改 transcript、provider 输入、tool approval 决策、tool execution 决策、tool result、compaction 状态、session persistence 或 lifecycle hook 语义。

#### Scenario: debug 事件不进入 transcript
- **WHEN** debug 模式记录 assistant turn 或 tool call 事件
- **THEN** 系统 SHALL NOT 将 debug 事件追加为 user、assistant、system、tool_call、tool_result、local_notice 或 error transcript record
- **THEN** `/resume` 加载的 session SHALL NOT 包含 debug 事件记录

#### Scenario: debug 事件不进入 provider 请求
- **WHEN** 系统构造 provider request
- **THEN** debug 日志内容 SHALL NOT 被加入 provider-visible records
- **THEN** debug 模式 SHALL NOT 改变 system prompt、tool schema、transcript 活跃区间或 plan mode transient suffix

#### Scenario: debug 写入失败不阻断主流程
- **WHEN** debug 日志文件创建、打开或写入失败
- **THEN** 系统 SHALL 继续执行 TUI 主流程
- **THEN** 系统 SHALL NOT 因 debug 写入失败中断 assistant turn、tool execution 或 compaction

### Requirement: debug 结构化事件日志
系统 SHALL 在 debug 模式下写入结构化 JSONL 日志。每一行 SHALL 表示一个事件，并包含 timestamp、递增序号、事件名和事件相关元数据。系统 SHALL 避免在热路径上记录 token 级或 redraw 级高频事件。

#### Scenario: 写入启动事件
- **WHEN** debug 模式启动成功
- **THEN** debug 日志 SHALL 包含 app 启动事件
- **THEN** 事件 SHALL 包含 cwd、Node.js 版本、进程 id 和日志路径等运行时摘要

#### Scenario: 写入 assistant turn 生命周期事件
- **WHEN** 用户提交普通消息并触发 assistant turn
- **THEN** debug 日志 SHALL 记录 assistant turn start 事件
- **WHEN** assistant turn 完成、失败或被取消
- **THEN** debug 日志 SHALL 记录对应的完成、失败或取消事件

#### Scenario: 写入 provider request 摘要
- **WHEN** agent loop runtime 完成 provider-visible records 构造
- **THEN** debug 日志 SHALL 记录 provider request 摘要事件
- **THEN** 事件 SHALL 包含 interaction mode、record 数量、record role 序列、关键输入 hash、tool schema hash 和 compaction 边界摘要
- **THEN** 事件 SHALL NOT 默认包含完整 system prompt、完整用户消息或完整 tool result 文本

#### Scenario: 写入 tool 和 compaction 事件
- **WHEN** 系统准备处理 tool call
- **THEN** debug 日志 SHALL 记录 tool call start 摘要
- **WHEN** tool call 产生结果、拒绝结果或交互式工具结果
- **THEN** debug 日志 SHALL 记录 tool call end 摘要
- **WHEN** 系统完成自动 compaction
- **THEN** debug 日志 SHALL 记录 compaction end 摘要

### Requirement: debug 敏感信息保护
系统 SHALL 对 debug 日志 payload 做敏感信息保护。Debug 日志 SHALL NOT 记录 LLM provider API key、headers、完整 provider client 配置或未截断的大段用户/工具内容。

#### Scenario: provider 配置被脱敏
- **WHEN** debug 日志记录 provider 或模型配置摘要
- **THEN** 日志 SHALL NOT 包含 apiKey
- **THEN** 日志 SHALL NOT 包含 headers 明文
- **THEN** 日志 MAY 包含 provider 类型、model id 和 context window 等非密钥摘要

#### Scenario: 文本内容默认摘要化
- **WHEN** debug 日志记录用户消息、assistant 输出、tool arguments 或 tool result 相关事件
- **THEN** 日志 SHALL 默认记录长度、hash、角色和状态等摘要
- **THEN** 日志 SHALL NOT 默认记录完整文本内容

### Requirement: debug 短提示
系统 SHALL 在 debug 模式启用时显示一个短提示，告知开发者 debug 已启用及日志路径。该提示 SHALL NOT 要求新增 footer 布局、状态栏字段、渲染 block 类型或改变现有 transcript 渲染规则。

#### Scenario: debug 启用后显示短提示
- **WHEN** TUI 在 debug 模式下启动
- **THEN** 系统 SHALL 显示一个短提示说明 debug 已启用
- **THEN** 提示 SHALL 包含或指向 debug 日志路径

#### Scenario: 非 debug 模式不显示提示
- **WHEN** TUI 在非 debug 模式下启动
- **THEN** 系统 SHALL NOT 显示 debug 启用提示
- **THEN** 普通启动 banner、footer 和 transcript 展示 SHALL 保持既有行为
