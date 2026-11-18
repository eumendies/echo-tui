## ADDED Requirements

### Requirement: 会话创建后的首条用户消息触发一次标题生成
系统 SHALL 在主 transcript 的会话创建后第一条用户记录成功追加时，启动一次异步标题生成。该生成 SHALL NOT 阻塞 assistant turn 的首个流式响应，且 SHALL NOT 在以下情况启动：恢复已有 session、`/fork` 创建的新 session、`/btw` side conversation、subagent 运行、headless `--once`。

去重条件 SHALL 基于"当前 session 的首条用户记录"这一结构事实，SHALL NOT 依赖 index 中已存在标题，因为 index 在任何时候都持有派生标题。

#### Scenario: 新会话首条消息触发生成
- **WHEN** 用户在当前没有持久化 session 的状态下提交第一条普通消息
- **THEN** 系统 SHALL 在该 user record 追加成功后启动一次标题生成请求
- **THEN** assistant turn SHALL 立即继续，不等待该请求返回

#### Scenario: 同一会话不重复生成
- **WHEN** 同一 session 已存在首条用户记录，用户继续提交后续消息
- **THEN** 系统 SHALL NOT 再次启动标题生成

#### Scenario: 恢复会话不触发生成
- **WHEN** 用户通过 `/resume` 恢复一个已有 session 并发送消息
- **THEN** 系统 SHALL NOT 为该 session 启动标题生成
- **THEN** 该 session 的现有标题 SHALL 保持不变

#### Scenario: 分支会话不触发生成
- **WHEN** 用户执行 `/fork` 后在新 session 中发送消息
- **THEN** 系统 SHALL NOT 为新 session 启动标题生成

#### Scenario: Headless 路径不生成
- **WHEN** 以 `echo-tui --once` 运行一次 headless 请求
- **THEN** 系统 SHALL NOT 发起标题生成请求

### Requirement: 标题生成使用无工具的独立模型请求
系统 SHALL 通过独立的 provider 请求生成标题，该请求 SHALL 只包含一条 system 指令与首条用户消息，SHALL NOT 装配工具 registry、SHALL NOT 合并 MCP tools，并 SHALL 覆盖 `reasoningEffort` 为 `low`。

当 `sessions.titleGenerationEnabled` 为 `false` 时，系统 SHALL NOT 解析模型 profile、SHALL NOT 构造 provider，也 SHALL NOT 发起任何标题生成请求；该开关缺省 SHALL 视为开启。

模型选择 SHALL 按以下顺序解析：
1. 当 `sessions.titleModelProfileId` 配置存在时，严格解析该 model profile；解析失败视为本次生成失败，SHALL NOT 回退到当前模型。
2. 当配置缺失时，使用当前生效的 model profile 并覆盖 effort 为 `low`。

#### Scenario: 未配置专用模型时使用当前模型
- **WHEN** `sessions.titleModelProfileId` 缺失
- **THEN** 系统 SHALL 使用当前生效的 model profile 发起请求
- **THEN** 请求的 `reasoningEffort` SHALL 为 `low`

#### Scenario: 配置专用模型
- **WHEN** `sessions.titleModelProfileId` 引用一个有效的已保存 model profile
- **THEN** 系统 SHALL 使用该 profile 的 provider 与 model 发起请求
- **THEN** 请求的 `reasoningEffort` SHALL 被覆盖为 `low`

#### Scenario: 配置引用失效不静默回退
- **WHEN** `sessions.titleModelProfileId` 引用的 profile 已不存在
- **THEN** 本次标题生成 SHALL 失败
- **THEN** 系统 SHALL NOT 改用当前模型重试

#### Scenario: 请求不携带工具
- **WHEN** 系统发起标题生成请求
- **THEN** 该请求 SHALL NOT 包含任何工具定义
- **THEN** 该请求 SHALL NOT 包含 MCP tools

#### Scenario: 关闭标题生成时不发起任何请求
- **WHEN** `sessions.titleGenerationEnabled` 为 `false`
- **AND** 会话创建后的首条用户消息被追加
- **THEN** 系统 SHALL NOT 解析标题生成模型
- **THEN** 系统 SHALL NOT 构造 provider 或发起请求
- **THEN** 会话 SHALL 保留派生标题

### Requirement: 生成标题的规范化与合法性判定
系统 SHALL 从模型输出中提取标题文本，并依次执行：去除首尾空白、去除首尾引号（含单引号、双引号、反引号与中英文引号）、合并连续空白为单个空格、去除尾部 `.`、`?`、`!`。规范化后 SHALL 按 grapheme cluster 截断到最多 60 个字符，与派生标题使用同一截断口径。

规范化结果为空字符串、模型输出无法解析或请求失败时，系统 SHALL 将该标题视为无效并保留现有标题。

#### Scenario: 规范化多余引号与标点
- **WHEN** 模型返回 `"修复登录按钮。"` 或 `` `修复登录按钮!` ``
- **THEN** 系统 SHALL 提取为 `修复登录按钮`

#### Scenario: 压缩多余空白
- **WHEN** 模型返回包含换行或多个连续空格的标题
- **THEN** 系统 SHALL 将其合并为单个空格

#### Scenario: 截断超长标题
- **WHEN** 规范化后的标题超过 60 个字符
- **THEN** 系统 SHALL 按 grapheme cluster 截断到 60 个字符
- **THEN** 系统 SHALL NOT 拆开代理对或 ZWJ emoji 序列

#### Scenario: 空输出判定为失败
- **WHEN** 模型输出只包含空白、引号或标点
- **THEN** 系统 SHALL 判定本次生成失败
- **THEN** 系统 SHALL NOT 写入空标题

### Requirement: 标题持久化与派生回退
系统 SHALL 将生成的标题写入当前 session 的 index 条目，并在条目中记录标题来源 `titleSource`，取值为 `derived` 或 `generated`；缺失时 SHALL 按 `derived` 处理以兼容旧 index。

`generated` 标题 SHALL 在 journal 指纹失配、重新 replay 或首条用户消息变化时保持不变；`derived` 标题 SHALL 跟随 replay 后的第一条用户消息重新派生。指纹 SHALL 只决定消息数量与派生标题是否需要重算。

当 index 条目不存在或标题缺失时，系统 SHALL 使用现有 `createSessionTitle` 从 replay 后第一条用户消息派生标题作为回退值。index 条目的标题 SHALL 始终为非空字符串。

#### Scenario: 生成的标题在后续追加中保持
- **GIVEN** 某 session 的 index 条目已写入生成标题
- **WHEN** 用户继续在该 session 中发送消息，导致 journal 指纹变化
- **THEN** 系统 SHALL 保留该生成标题
- **THEN** index 条目的消息数量 SHALL 被更新

#### Scenario: 生成标题不被派生更新覆盖
- **GIVEN** 某 session 的 index 条目已写入生成标题
- **WHEN** 调用方以派生标题更新该条目且未声明 `generated` 来源
- **THEN** 系统 SHALL 保留生成标题与 `generated` 标记

#### Scenario: 截断首条用户消息后重算派生标题
- **GIVEN** 某 session 的 index 标题来源为 `derived`
- **WHEN** `truncate_records` 移除原首条用户消息并写入新的首条消息
- **THEN** index 重建后的标题 SHALL 来自新的首条用户消息
- **THEN** 系统 SHALL NOT 保留被移除消息派生的旧标题

#### Scenario: 首次重建使用派生标题
- **GIVEN** 某 session 的 index 条目不存在
- **WHEN** 系统重建该条目
- **THEN** 系统 SHALL 使用 `createSessionTitle` 派生标题
- **THEN** 该条目的 `titleSource` SHALL 为 `derived`

#### Scenario: 无用户消息的会话
- **WHEN** 某 session 没有任何用户记录
- **THEN** 其 index 标题 SHALL 为 `未命名对话`

#### Scenario: 生成期间展示未命名占位
- **WHEN** 标题生成请求尚未返回，且该会话已进入首次生成等待
- **THEN** statusline SHALL 展示「未命名对话」占位
- **THEN** statusline SHALL NOT 展示派生标题
- **THEN** `/resume` 与 `/reference` SHALL 继续使用 index 中的派生标题，避免候选列表出现空标题

#### Scenario: 生成失败后回落到派生标题
- **WHEN** 首次标题生成返回空结果或请求失败
- **THEN** 系统 SHALL 结束等待状态
- **THEN** statusline SHALL 展示派生标题
- **THEN** index 标题 SHALL 保持为派生值

#### Scenario: 关闭生成时不进入等待
- **WHEN** `sessions.titleGenerationEnabled` 为 `false`
- **THEN** 系统 SHALL NOT 进入首次生成等待
- **THEN** statusline SHALL 直接展示派生标题，不出现未命名占位

### Requirement: statusline 展示当前会话标题
系统 SHALL 在普通输入状态下的 statusline 中展示当前会话标题。该标题 SHALL 位于左侧分段中 model 与 effort 之后、工具标记与项目目录之前，并 SHALL 按固定字符预算截断。当可用宽度不足时，系统 SHALL 沿用现有从右截断策略：model 与 effort 优先保留，标题与项目目录允许被裁掉。

在命令 surface、模型调节或 shell 交互模式占据 footer 时，系统 SHALL NOT 额外渲染该标题分段。

#### Scenario: 宽终端展示标题
- **WHEN** statusline 有足够水平空间
- **THEN** 系统 SHALL 在 model 与 effort 之后、工具标记与项目目录之前展示当前会话标题

#### Scenario: 窄终端按分段顺序裁剪
- **WHEN** statusline 水平空间不足以容纳全部左侧分段
- **THEN** 系统 SHALL 按现有从右截断策略处理
- **THEN** model 与 effort SHALL 优先保留
- **THEN** 标题与项目目录 SHALL 允许被截断

#### Scenario: 模型调节期间隐藏标题
- **WHEN** statusline 处于模型调节状态
- **THEN** 系统 SHALL NOT 渲染标题分段

#### Scenario: 标题切换会话后刷新
- **WHEN** 用户通过 `/resume` 或 `/fork` 切换当前 session
- **THEN** statusline SHALL 展示新 session 的标题
