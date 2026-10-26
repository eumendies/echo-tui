## MODIFIED Requirements

### Requirement: provider 使用配置选择文件编辑工具 schema
真实 LLM adapter SHALL 只转换当前运行最终 registry 中已注册的文件编辑工具 definition，不得在 adapter 内硬编码补充或排除 `apply_patch` 或 `edit_file`。OpenAI Responses、OpenAI Chat、Anthropic 和 Codex SHALL 支持按主 Agent 独立工具选择投影零个、一个或两个文件编辑工具 schema；`disabledTools` 缺失时 SHALL 默认 `[]`，同时投影两个编辑 schema 及其他可用工具。系统 SHALL NOT 读取旧 `tools.fileEdit.mode`；子运行 SHALL 只投影自身白名单筛选后的最终 registry，不继承主禁用名单。其他已注册工具及历史 transcript 的协议转换语义 SHALL 保持不变。

#### Scenario: 仅启用 edit_file 时构造 provider request
- **WHEN** 主 Agent 归一化工具选择仅启用 `edit_file`，且真实 agent 准备 provider request
- **THEN** request tools SHALL 包含要求 `path`、`old_string` 和 `new_string` 的 `edit_file` function tool definition
- **THEN** request tools SHALL NOT 包含 `apply_patch` function tool definition
- **THEN** 其他已注册本地工具和 MCP tools SHALL 继续按既有 adapter 规则转换

#### Scenario: 缺失名单默认投影两个编辑 schema
- **WHEN** 主 Agent 的 `disabledTools` 缺失，无论旧文件编辑模式是否存在及其值
- **THEN** 各 provider request tools SHALL 同时包含 `apply_patch` 与 `edit_file` function tool definitions 及其他可用工具
- **THEN** adapter SHALL NOT 根据旧文件编辑模式排除任一 schema

#### Scenario: 两个编辑工具同时开启
- **WHEN** 主 Agent 工具选择同时启用 `apply_patch` 和 `edit_file`
- **THEN** 各 provider request tools SHALL 同时包含两个工具的 schema
- **THEN** adapter SHALL NOT 自行根据旧 mode 删除其中一个

#### Scenario: 两个编辑工具同时关闭
- **WHEN** 主 Agent 工具选择同时禁用 `apply_patch` 和 `edit_file`
- **THEN** 各 provider request tools SHALL 不包含任一文件编辑 schema，且 SHALL 继续包含 Bash

#### Scenario: runtime 执行已启用的 edit_file tool call
- **WHEN** provider 返回已注册的 `edit_file` tool call
- **THEN** agent loop runtime SHALL 通过普通 tool executor 执行已注册 handler
- **THEN** runtime SHALL 将真实 result 追加为匹配 call id 与工具名的 `tool_result` record
- **THEN** provider continuation SHALL 接收原始 result text，而不是 TUI diff 投影

#### Scenario: 配置切换不改变历史 continuation 事实
- **WHEN** transcript 已包含历史 `apply_patch` 或 `edit_file` call/result records，且后续主运行更改编辑工具开关
- **THEN** provider adapter SHALL 继续按既有 transcript 转换规则保留历史匹配 call/result
- **THEN** 当前 request 的可调用工具 definition SHALL 只包含本轮实际启用的编辑工具

### Requirement: provider system prompt 注入 skill catalog
真实 LLM adapter 的 provider records 构建 SHALL 在当前运行已注册 `use_skill` 且存在可用 skill 时，在内置 system prompt 中包含该运行可用的 skill catalog。catalog SHALL 基于当前运行的 skill registry 生成，且 SHALL 只包含模型选择 skill 所需的短元数据。未注册 `use_skill` 时 SHALL 不自动注入该目录或声称模型可以调用该工具；主运行是否注册该工具 SHALL NOT 改变子运行的独立 Skill scope。

#### Scenario: 构造 provider records 时包含 skill catalog
- **WHEN** agent loop runtime 构造 provider records，当前 registry 已注册 `use_skill` 且存在可用 skill
- **THEN** 第一条 system record SHALL 包含内置系统提示和 skill catalog
- **THEN** catalog SHALL 包含每个 skill 的名称和描述

#### Scenario: catalog 引导模型调用 use_skill
- **WHEN** system prompt 包含自动注入的 skill catalog
- **THEN** 当前 registry SHALL 包含 `use_skill`，且 catalog 文本 SHALL 说明模型可在用户请求明确匹配某个 skill 时调用该工具
- **THEN** catalog 文本 SHALL NOT 要求模型无条件加载全部 skill

#### Scenario: skill catalog 随 registry 更新
- **WHEN** 发起新的 agent run，当前 registry 已注册 `use_skill`，且 skill 文件内容或集合已变化
- **THEN** 系统 SHALL 基于当前文件系统重新生成或刷新 skill catalog
- **THEN** 后续 provider 请求 SHALL 使用最新可用的 skill 名称和描述

#### Scenario: 无 skill 时保持原请求形态
- **WHEN** 当前没有可用 skill
- **THEN** provider system prompt SHALL 保持不包含 skill catalog
- **THEN** 普通 OpenAI input 转换和工具 schema 发送语义 SHALL 保持不变

#### Scenario: 主运行禁用 Skill 工具
- **WHEN** 主 Agent 禁用 `use_skill`，但父 enabled Skill snapshot 中仍有条目
- **THEN** 主运行 SHALL 不自动注入 skill catalog 或宣称 `use_skill` 可调用
- **THEN** 父 Skill snapshot SHALL 保留，子运行 SHALL 按自身 registry 与 scope 决定是否注入目录
