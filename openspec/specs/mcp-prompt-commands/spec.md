# mcp-prompt-commands Specification

## Purpose
定义 echo_tui 对 Model Context Protocol prompts 能力的集成行为：按 server capability 门控且有界的 prompt 目录发现与 `list changed` 刷新、`/<server>:<prompt>` 命令的注册与命名优先级、位置与键值参数解析和缺必填收集、prompts messages 按序拼接为单条用户消息的形态与溯源 metadata，以及 plan / 只读运行 / headless / 子 Agent 边界与失败提示。
## Requirements
### Requirement: prompt 目录发现与失效按 capability 门控且有界
MCP manager SHALL 在 bootstrap 与 reload 时为每个已初始化的 server 发现 prompts。发现 SHALL 以 server 声明的 `prompts` capability 为门控：未声明该 capability 的 server SHALL NOT 被调用，其 prompt 目录视为空。声明了 capability 但调用返回 `-32601` 或其它错误时，该 server 的 prompt 目录 SHALL 降级为空并记录既有脱敏诊断，SHALL NOT 影响该 server 的工具、资源与连接状态。目录 SHALL 跟随分页游标并设置页数与条目上限，且 SHALL 对名称与描述长度设上限。收到 `notifications/prompts/list_changed` 时，manager SHALL 只把缓存标记为失效并在下一次目录读取前重新拉取，SHALL NOT 为此重连进程或中断进行中的运行。

#### Scenario: 声明 prompts 的 server 被拉取目录
- **WHEN** 某 server 在初始化响应中声明 `prompts` capability
- **THEN** manager SHALL 拉取该 server 的 prompt 列表并缓存
- **THEN** 缓存 SHALL 包含每项 prompt 的 server 名、名称、可选描述与参数声明

#### Scenario: 未声明 capability 的 server 不被调用
- **WHEN** 某 server 未声明 `prompts` capability
- **THEN** manager SHALL NOT 向该 server 发送任何 prompts 请求
- **THEN** 该 server 的工具与资源能力 SHALL 保持不变

#### Scenario: 可选端点失败只降级
- **WHEN** 声明了 capability 的 server 对 `prompts/list` 返回 `-32601` 或其它错误
- **THEN** manager SHALL 把该 server 的 prompt 目录降级为空并记录脱敏诊断
- **THEN** 系统 SHALL NOT 因此禁用该 server 或影响其它 server

#### Scenario: list changed 通知只标记失效
- **WHEN** manager 收到 `notifications/prompts/list_changed`
- **THEN** manager SHALL 标记该 server 的 prompt 目录失效
- **THEN** 下一次目录读取 SHALL 重新拉取该 server 的目录
- **THEN** 进行中的 run SHALL NOT 被中断，命令集合 SHALL 在下次 run 或启动时更新

### Requirement: prompt 命令的注册与命名
系统 SHALL 为每个已发现的 prompt 注册斜杠命令 `/<server>:<prompt>`，并 SHALL 把描述符与既有 slash 描述符合并进建议清单。命令 handler SHALL 排列在所有内置命令之后、direct skill invocation fallback **之前**，以保证内置命令优先且 prompt 命令不会被万能 fallback 吞掉。server 名与 prompt 名中的空白和 `/` SHALL 归一为 `-`；归一后冲突时 SHALL 保留首个并记录诊断。未配置 MCP、`mcp.enabled` 为 false 或没有任何 server 初始化成功时，系统 SHALL NOT 注册任何 prompt 命令。

#### Scenario: 注册 prompt 命令并出现在建议清单
- **WHEN** 某 server 暴露 prompt `code_review` 且用户在 composer 输入 `/`
- **THEN** 建议清单 SHALL 包含名为 `<server>:code_review` 的候选项及其描述
- **THEN** 前缀匹配与 Tab 补全 SHALL 按既有的建议清单语义生效

#### Scenario: 内置命令与技能不受遮蔽
- **WHEN** prompt 名称与某个内置命令或技能名相同
- **THEN** 内置命令 SHALL 优先命中
- **THEN** 未命中任何内置命令时，`/<server>:<prompt>` SHALL 优先于 direct skill invocation fallback

#### Scenario: active assistant turn 期间不可启动
- **WHEN** 当前存在 active assistant turn 且用户输入 prompt 命令
- **THEN** 建议清单 SHALL NOT 展示该命令
- **THEN** 提交 SHALL 按既有规则进入 pending message 而不是启动命令

#### Scenario: 未启用 MCP 时不注册命令
- **WHEN** 用户配置没有 `mcp` 节点、`mcp.enabled` 为 false，或没有任何 server 初始化成功
- **THEN** 建议清单 SHALL NOT 包含任何 `<server>:<prompt>` 候选项

### Requirement: prompt 参数解析与缺失收集
命令 SHALL 把 `/<server>:<prompt>` 之后的内容解析为 prompt 参数：按 server 声明的 `arguments` 顺序把位置参数映射到参数名，并 SHALL 支持 `key=value` 形式按名覆盖。缺少必填参数时，命令 SHALL 打开交互 surface 逐项收集剩余参数，SHALL NOT 直接注入不完整内容。无参数 prompt 在提交后 SHALL 直接注入，不要求二次确认。用户在收集过程中取消时，系统 SHALL NOT 注入任何内容并 SHALL 保持 composer 状态可用。

#### Scenario: 位置参数按声明顺序映射
- **WHEN** prompt 声明 `city` 与 `state` 两个参数且用户提交 `/weather:forecast Beijing`
- **THEN** 系统 SHALL 把 `Beijing` 映射到第一个参数 `city`
- **THEN** 未提供的位置参数 SHALL 按缺失处理

#### Scenario: key=value 覆盖按名传参
- **WHEN** 用户提交 `/weather:forecast city=Beijing state=CN` 或 `city=Beijing`
- **THEN** 系统 SHALL 按参数名绑定取值
- **THEN** 绑定结果 SHALL 优先于位置参数

#### Scenario: 缺必填参数走交互收集
- **WHEN** 用户提交的 prompt 缺少必填参数
- **THEN** 命令 SHALL 打开 `choice` surface 逐项收集缺失参数
- **THEN** 全部收集完成后 SHALL 按正常流程注入

#### Scenario: 收集阶段取消
- **WHEN** 用户在参数收集 surface 中按 Esc
- **THEN** 系统 SHALL NOT 注入任何消息
- **THEN** composer SHALL 保持可用且不残留命令状态

#### Scenario: 无参数 prompt 直接注入
- **WHEN** 用户提交一个没有参数声明的 prompt 命令
- **THEN** 系统 SHALL 立即取回 messages 并注入，不进入额外确认步骤

### Requirement: prompt messages 的注入形态与溯源
系统 SHALL 调用 `prompts/get`，并 SHALL 把返回的 messages 按服务端顺序拼接为**单条用户消息**：每条文本内容前 SHALL 标注其 role（如 `[user]`、`[assistant]`）。非文本内容块 SHALL 转为有界占位符：图片 SHALL 给出 mimeType 与字节数，embedded resource SHALL 给出 uri 并提示可用 `read_mcp_resource` 读取，resource_link SHALL 给出 uri。拼接结果超过 20,000 UTF-8 bytes 时 SHALL 截断并追加截断 marker。transcript SHALL 展示用户实际输入的 `/<server>:<prompt>` 文本，注入的 user record SHALL 携带 `metadata.mcpPrompt: {server, name, argumentsText}` 以便与普通用户消息区分。provider SHALL 只看到一条普通 user message，不伪造 assistant 记录。

#### Scenario: 多角色 messages 拼接
- **WHEN** prompt 返回一条 `role: user` 与一条 `role: assistant` 文本消息
- **THEN** 注入文本 SHALL 按顺序包含带 role 标签的两段内容
- **THEN** 注入结果 SHALL 是单条 user message

#### Scenario: 非文本内容转占位符
- **WHEN** messages 包含图片内容块、embedded resource 或 resource_link
- **THEN** 注入文本 SHALL 包含对应占位符（mimeType 与字节数、uri 与读取提示）
- **THEN** 系统 SHALL NOT 静默丢弃该内容

#### Scenario: 超长内容被截断
- **WHEN** 拼接结果超过 20,000 UTF-8 bytes
- **THEN** 注入文本 SHALL 被截断并包含截断 marker
- **THEN** 截断 SHALL NOT 破坏 role 标签与占位符的可读性

#### Scenario: transcript 溯源与展示
- **WHEN** prompt 命令成功注入
- **THEN** transcript SHALL 展示用户输入的 `/<server>:<prompt>` 文本
- **THEN** 该 user record SHALL 携带 `metadata.mcpPrompt` 域信息
- **THEN** `/resume` 重放 SHALL 保持相同展示与元数据

### Requirement: prompt 命令的边界与失败提示
prompt 命令由用户显式发起，因此 SHALL NOT 进入工具审批流程；在 plan 模式与只读运行（BTW、`/review`）下 SHALL 与普通用户消息遵循同一执行边界；headless `--once` SHALL NOT 注册该命令；子 Agent SHALL NOT 获得 prompts 能力。当 `/<server>:<prompt>` 指向不存在的 server 或 prompt，或取回消息失败时，命令 SHALL 打开 `info` surface 说明原因并列出可用的 server 与 prompt 名称，SHALL NOT 静默失败或注入空消息。

#### Scenario: 不触发工具审批
- **WHEN** 用户提交一个 prompt 命令
- **THEN** 系统 SHALL NOT 打开工具审批 surface
- **THEN** 注入内容触发的后续工具调用 SHALL 继续按当时边界分类

#### Scenario: plan 与只读运行保持一致
- **WHEN** 当前为 plan 模式或只读运行
- **THEN** prompt 注入 SHALL 与普通用户消息使用同一路径
- **THEN** 系统 SHALL NOT 因为来源是 MCP 而收紧或放宽既有边界

#### Scenario: 未知 server 或 prompt
- **WHEN** 用户提交的 server 或 prompt 名称不在当前缓存目录中
- **THEN** 命令 SHALL 打开 `info` surface 说明未命中
- **THEN** surface SHALL 列出当前可用的 server 与 prompt 名称

#### Scenario: 取回消息失败
- **WHEN** `prompts/get` 返回错误或超时
- **THEN** 系统 SHALL NOT 注入内容
- **THEN** 命令 SHALL 展示经过既有脱敏的有界错误信息

#### Scenario: headless 与子 Agent 不可用
- **WHEN** 以 `--once` 运行或处于任一子 Agent 运行中
- **THEN** 系统 SHALL NOT 注册或暴露 prompt 命令
- **THEN** 子 Agent provider-visible schema SHALL 不包含任何 prompts 相关能力

