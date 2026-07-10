## MODIFIED Requirements

### Requirement: 本地 slash 命令与真实 adapter 隔离
系统 SHALL 保持本地 slash 命令与真实 LLM adapter 隔离。命中本地 slash handler 的输入 SHALL 由 command runtime 处理，而不是提交给真实 agent；纯 `/model` SHALL 在 composer/footer 区域打开模型 command surface，展示当前真实模型配置、可用模型 profile 或安全配置错误。存在多个可选 profile 时，`/model` SHALL 允许用户选择模型并将选择持久化到用户级 LLM 配置；该命令 SHALL NOT 写入 transcript 或启动真实 agent。系统 SHALL 在普通 composer 输入态为 slash 命令提供临时提示和补全能力，提示交互 SHALL NOT 启动 command session、写入 transcript、进入输入历史或触发真实 agent。

#### Scenario: 本地 slash 命令不启动真实 agent
- **WHEN** 用户提交纯 `/help`、`/model`、`/clear` 或 `/resume` 且命中对应本地 slash handler
- **THEN** 系统 SHALL 由 slash command runtime 处理该输入
- **THEN** 系统 SHALL NOT 调用真实 LLM adapter

#### Scenario: slash 前缀显示命令提示
- **WHEN** assistant 未处于 thinking 或 streaming，且没有 active command session，且 composer 内容是以 `/` 开头的单行 slash 前缀
- **THEN** 系统 SHALL 在普通 composer 下方显示 slash 命令提示列表
- **THEN** 每个提示项 SHALL 在单行内展示 slash 命令和用户可见描述
- **THEN** composer 光标 SHALL 保持可见并位于当前输入位置

#### Scenario: slash 命令提示按前缀过滤
- **WHEN** composer 内容为 `/`
- **THEN** 系统 SHALL 展示所有可用本地 slash 命令
- **WHEN** composer 内容为 `/m`
- **THEN** 系统 SHALL 只展示命令名以 `/m` 为前缀的可用 slash 命令

#### Scenario: slash 命令提示不在普通文本中显示
- **WHEN** composer 内容不是以 `/` 开头，或内容包含空格，或内容包含换行
- **THEN** 系统 SHALL NOT 显示 slash 命令提示列表
- **THEN** Up/Down SHALL 保持现有输入历史浏览或 composer 多行移动行为

#### Scenario: slash 命令提示方向键移动选择
- **WHEN** slash 命令提示列表处于可见状态，且用户按下 Up 或 Down
- **THEN** 系统 SHALL 更新提示列表中的当前选中项
- **THEN** 选择到达提示列表首尾后 SHALL 循环到另一端
- **THEN** 系统 SHALL NOT 修改 composer 文本
- **THEN** 系统 SHALL NOT 写入配置文件、transcript 或输入历史

#### Scenario: Tab 补全 slash 命令
- **WHEN** slash 命令提示列表处于可见状态，且用户按下 Tab
- **THEN** 系统 SHALL 将当前选中的 slash 命令写入 composer
- **THEN** 补全文本 SHALL 是纯 slash 命令，不自动追加空格
- **THEN** 系统 SHALL NOT 启动 command session、写入 transcript 或触发真实 agent

#### Scenario: active command session 隐藏 slash 命令提示
- **WHEN** `/model`、`/resume`、`/clear` 或 `/help` 的 command session 已经处于活跃状态
- **THEN** 系统 SHALL NOT 显示 slash 命令提示列表
- **THEN** Up/Down/Enter/Esc SHALL 继续交给 active command session 处理

#### Scenario: response 进行中隐藏 slash 命令提示
- **WHEN** assistant 正在 thinking 或 streaming，且 composer 内容以 `/` 开头
- **THEN** 系统 SHALL NOT 显示 slash 命令提示列表
- **THEN** 系统 SHALL NOT 允许提示补全绕过 response lock 启动本地 slash command

#### Scenario: /model 显示模型选择列表
- **WHEN** 用户提交纯 `/model` 且当前 `~/.echo/config.json` 中存在多个有效 `llm.models` profile
- **THEN** 系统 SHALL 打开 `select` command surface
- **THEN** 该 surface SHALL 在单行内展示可选模型 profile 的 label 和模型名
- **THEN** 当前生效的 profile SHALL 作为初始选中项

#### Scenario: /model 方向键移动选择
- **WHEN** `/model` select command session 处于活跃状态，且用户按下 Up 或 Down
- **THEN** 系统 SHALL 更新选中的模型 profile
- **THEN** 系统 SHALL 只更新 command session surface/data，不写入配置文件

#### Scenario: /model 确认选择并持久化
- **WHEN** `/model` select command session 处于活跃状态，且用户按下 Enter
- **THEN** 系统 SHALL 将选中 profile id 写入 `~/.echo/config.json` 的 `llm.selectedModel`
- **THEN** 系统 SHALL 关闭 `/model` command session 并清空 composer
- **THEN** 系统 SHALL NOT 追加 transcript record

#### Scenario: /model 取消选择不持久化
- **WHEN** `/model` command session 处于活跃状态，且用户按下 Esc
- **THEN** 系统 SHALL 关闭 `/model` command session 并清空 composer
- **THEN** 系统 SHALL 保持 `~/.echo/config.json` 不变

#### Scenario: /model 持久化失败显示安全错误
- **WHEN** `/model` 确认选择时无法写入用户级配置文件
- **THEN** 系统 SHALL 保持 `/model` command session 可见或打开安全错误 surface
- **THEN** 该 surface SHALL 展示可操作的安全错误摘要
- **THEN** 错误内容 SHALL NOT 包含敏感字段值

#### Scenario: /model 显示安全配置错误
- **WHEN** 用户提交纯 `/model` 但当前模型配置缺失、无效或无法读取
- **THEN** 系统 SHALL 打开安全的 command surface 展示可操作错误摘要
- **THEN** 错误内容 SHALL NOT 包含敏感字段值

#### Scenario: response 进行中阻止 /model
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交纯 `/model`
- **THEN** 系统 SHALL NOT 进入 `/model` command session
- **THEN** 系统 SHALL NOT 修改真实 LLM adapter 的模型配置
