## MODIFIED Requirements

### Requirement: 本地 slash 命令与真实 adapter 隔离
系统 SHALL 保持本地 slash 命令与真实 LLM adapter 隔离。命中本地 slash handler 的输入 SHALL 由 command runtime 处理，而不是提交给真实 agent；纯 `/model` SHALL 在 composer/footer 区域打开模型 command surface，展示当前真实模型配置、可用模型 profile 或安全配置错误。存在多个可选 profile 时，`/model` SHALL 允许用户选择模型并将选择持久化到用户级 LLM 配置；该命令 SHALL NOT 写入 transcript 或启动真实 agent。

#### Scenario: 本地 slash 命令不启动真实 agent
- **WHEN** 用户提交纯 `/help`、`/model`、`/clear` 或 `/resume` 且命中对应本地 slash handler
- **THEN** 系统 SHALL 由 slash command runtime 处理该输入
- **THEN** 系统 SHALL NOT 调用真实 LLM adapter

#### Scenario: /model 显示模型选择列表
- **WHEN** 用户提交纯 `/model` 且当前 `~/.echo/config.json` 中存在多个有效 `llm.models` profile
- **THEN** 系统 SHALL 打开 `select` command surface
- **THEN** 该 surface SHALL 展示可选模型 profile 的 label 和模型名
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
