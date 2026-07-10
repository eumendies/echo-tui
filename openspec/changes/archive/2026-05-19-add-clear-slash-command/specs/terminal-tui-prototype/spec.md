## ADDED Requirements

### Requirement: slash clear 清空命令
系统 SHALL 支持一个本地 slash 清空命令：当用户提交纯 `/clear` 时，应用 SHALL 在 composer/footer 区域显示确认型 command surface。该命令 SHALL 复用统一 slash 命令运行时、command session、effect interpreter 和 `confirm` command surface；确认后只清空当前 transcript records，不清空用于 Up/Down 回溯的 session 输入历史。

#### Scenario: 纯 /clear 打开清空确认面板
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/clear`
- **THEN** 系统 SHALL 进入 `/clear` command session
- **THEN** 系统 SHALL 在 composer/footer 区域显示 `confirm` command surface，说明确认后会清空当前 transcript，并突出 Enter 确认操作、明确 Esc 取消
- **THEN** 系统 SHALL NOT 把 `/clear` 写入 transcript、输入历史或 fake agent 生命周期

#### Scenario: 非纯 /clear 输入回退为普通消息
- **WHEN** 用户提交内容以 `/clear` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入清空确认面板

#### Scenario: Enter 确认清空 transcript
- **WHEN** `/clear` command session 处于活跃状态，且用户按下 Enter
- **THEN** 系统 SHALL 关闭 `/clear` command session
- **THEN** 系统 SHALL 清空当前 transcript records，并重绘当前 app snapshot，使旧 transcript 内容不再可见
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL NOT 启动 fake agent 的 thinking 或 streaming 生命周期
- **THEN** 系统 SHALL NOT 追加新的 transcript record 作为清空结果提示

#### Scenario: Enter 清空 transcript 时保留输入历史
- **WHEN** `/clear` command session 确认完成前 session 输入历史中已有普通消息
- **THEN** 系统 SHALL 保留这些输入历史
- **THEN** 用户随后在空 composer 中按 Up SHALL 仍能浏览到清空前成功提交过的普通消息

#### Scenario: Esc 取消清空 transcript
- **WHEN** `/clear` command session 处于活跃状态，且用户按下 Esc
- **THEN** 系统 SHALL 关闭 `/clear` command session
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL 保持 transcript records 不变
- **THEN** 系统 SHALL NOT 追加 transcript record

#### Scenario: response 进行中阻止 /clear
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交纯 `/clear`
- **THEN** 系统 SHALL NOT 进入 `/clear` command session
- **THEN** 系统 SHALL NOT 清空 transcript records
