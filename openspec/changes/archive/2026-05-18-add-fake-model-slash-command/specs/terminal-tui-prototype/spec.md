## ADDED Requirements

### Requirement: slash model 选择命令
系统 SHALL 支持一个 fake 的本地 slash 模型选择命令：当用户提交纯 `/model` 时，应用 SHALL 在 composer/footer 区域显示模型候选列表。该命令 SHALL 复用统一 slash 命令运行时、command session、effect interpreter 和 `select` command surface；候选模型 SHALL 写死在本地 handler 中，且选择结果 SHALL NOT 接入真实模型服务或改变 fake assistant 的响应逻辑。

#### Scenario: 纯 /model 打开模型选择列表
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/model`
- **THEN** 系统 SHALL 进入 `/model` command session
- **THEN** 系统 SHALL 在 composer/footer 区域显示 `select` command surface 和写死的模型候选项
- **THEN** 系统 SHALL NOT 把 `/model` 写入 transcript、输入历史或 fake agent 生命周期

#### Scenario: 非纯 /model 输入回退为普通消息
- **WHEN** 用户提交内容以 `/model` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入模型选择列表

#### Scenario: 方向键移动模型选择
- **WHEN** `/model` command session 处于活跃状态，且用户按下 Up 或 Down
- **THEN** 系统 SHALL 更新当前选中的模型候选项
- **THEN** 系统 SHALL 保持在 `/model` command session 中，并重绘 `select` command surface

#### Scenario: Enter 确认 fake 模型选择
- **WHEN** `/model` command session 处于活跃状态，且用户按下 Enter
- **THEN** 系统 SHALL 关闭 `/model` command session
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL 向 transcript 追加一条本地 assistant 提示，说明已选择的 fake model
- **THEN** 系统 SHALL NOT 启动 fake agent 的 thinking 或 streaming 生命周期

#### Scenario: Esc 取消 fake 模型选择
- **WHEN** `/model` command session 处于活跃状态，且用户按下 Esc
- **THEN** 系统 SHALL 关闭 `/model` command session
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL NOT 追加 transcript record
