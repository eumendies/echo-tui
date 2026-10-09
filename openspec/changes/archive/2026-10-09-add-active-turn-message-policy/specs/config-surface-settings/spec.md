## ADDED Requirements

### Requirement: 响应期间消息策略设置
系统 SHALL 在 `/config` 的“常规”Tab 提供“响应期间发送消息”设置，展示“排队”和“即时引导”两种选择，分别持久化为 `ui.activeTurnMessagePolicy` 的 `pending` 和 `steer`。默认值 SHALL 为 `pending`；字段缺失、类型错误或值不属于枚举时 SHALL 单独回退默认值，不阻断 TUI 或 headless 启动。界面 SHALL 说明即时引导不强制停止已启动工具。

#### Scenario: 旧配置保持排队
- **WHEN** 配置文件没有 `ui.activeTurnMessagePolicy`
- **THEN** 系统 SHALL 归一化为 `pending`
- **THEN** 常规页面 SHALL 显示“排队”，响应期普通提交 SHALL 保持现有 pending 行为

#### Scenario: 非法字段独立回退
- **WHEN** 消息策略字段为 boolean、null 或不支持的字符串
- **THEN** 系统 SHALL 对该字段使用 `pending`
- **THEN** 其他有效设置 SHALL 继续生效

#### Scenario: 调整选择只修改草稿
- **WHEN** 用户选中消息策略行并按 Left、Right 或 Enter
- **THEN** 草稿 SHALL 在“排队”和“即时引导”之间切换
- **THEN** 系统 SHALL NOT 在显式保存前修改配置文件或后续运行的默认策略

#### Scenario: 显式保存与配置保留
- **WHEN** 用户保存包含有效消息策略的常规草稿
- **THEN** 系统 SHALL 原子写入 `ui.activeTurnMessagePolicy` 并保留其他已知或未知配置字段
- **THEN** 系统 SHALL 更新 dirty fingerprint 和成功反馈，保持配置中心打开

#### Scenario: 无效草稿不能写入
- **WHEN** 常规草稿中的消息策略不是 `pending` 或 `steer`
- **AND** 用户请求保存
- **THEN** 系统 SHALL 显示可理解错误且不写入配置文件

### Requirement: 消息策略按 assistant turn 固定
交互式主 assistant turn SHALL 在启动时从同一配置 snapshot 捕获消息策略，提交控制器和运行中输入通道 SHALL 使用该固定值。保存或 watcher 刷新 SHALL 只改变后续 turn 的默认策略，不重新解释当前 turn 或已接收消息；render 热路径 SHALL NOT 读取配置文件。该设置 SHALL NOT 创建 headless stdin 监听或改变 BTW、子代理和 shell 的输入行为。

#### Scenario: 活动 turn 期间刷新策略
- **WHEN** 当前 turn 以 `pending` 启动且 watcher 将配置刷新为 `steer`
- **THEN** 当前 turn 中的后续普通提交 SHALL 仍使用 `pending`
- **THEN** 下一次主 assistant turn SHALL 使用 `steer`
- **THEN** 已排队的消息 SHALL NOT 被追溯注入当前运行

#### Scenario: 引导等待期间改回排队
- **WHEN** 当前 turn 使用 `steer` 且有引导消息等待工具收尾
- **AND** 默认配置变为 `pending`
- **THEN** 当前消息 SHALL 保持引导类型和原目标 turn
- **THEN** 后续新 turn SHALL 使用 `pending`

#### Scenario: headless 无运行中交互
- **WHEN** 用户配置为 `steer` 并执行 `--once`
- **THEN** headless SHALL 保持单次输入、无 stdin 等待与原审批策略
- **THEN** 系统 SHALL NOT 为即时引导创建 TUI 或运行中输入监听
