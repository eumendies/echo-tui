## ADDED Requirements

### Requirement: slash handler 显式依赖注入
系统 SHALL 在 app 装配阶段创建默认 slash command handler 实例，并将每个 handler 实际需要的语义子 context 或纯配置显式注入到该 handler。command runtime SHALL NOT 负责从 AppContext 聚合所有 handler 可能需要的业务上下文。

#### Scenario: 默认 handler 注册显式声明依赖
- **WHEN** app 创建默认 slash command handlers
- **THEN** `/help` 和 `/clear` 这类不需要读取业务状态的 handler SHALL NOT 接收业务子 context
- **THEN** `/model` handler SHALL 只接收读取模型命令信息所需的 context 或能力
- **THEN** `/resume` handler SHALL 只接收列出可恢复 session metadata 所需的 context 或能力

#### Scenario: runtime 不再拼装全量业务上下文
- **WHEN** command runtime 启动已命中的 slash handler
- **THEN** runtime SHALL 调用 handler 的命令协议方法并传递 runtime 自己拥有的命令运行态信息
- **THEN** runtime SHALL NOT 为该调用拼装包含 `modelCommandInfo`、`resumeSessions`、composer 文本和输入历史等所有命令业务字段的统一上下文

#### Scenario: handler 读取依赖不改变写入边界
- **WHEN** slash handler 通过构造期注入的子 context 读取命令所需数据
- **THEN** handler SHALL 继续通过结构化 effect 请求重置 composer、打开或关闭 command session、清空 transcript、加载 transcript session 或追加 transcript record
- **THEN** handler SHALL NOT 直接驱动 renderer、terminal 或绕过 command runtime 修改 app 状态

## MODIFIED Requirements

### Requirement: slash 命令运行时
系统 SHALL 通过统一的 slash 命令运行时处理本地 slash 命令。slash 路由器 SHALL 依次询问各个命令 handler 是否命中当前已提交文本；若没有任何 handler 命中，则输入 SHALL 按普通 user message 处理。slash command handler 的业务读取依赖 SHALL 在 app 装配阶段显式注入，而不是由 command runtime 为所有 handler 统一生成 AppContext 业务上下文。

#### Scenario: handler 命中决定 slash 路由结果
- **WHEN** 用户提交一段输入文本，且某个 slash handler 判定该文本命中自身命令
- **THEN** 系统 SHALL 将该输入路由到该 handler，而不是按普通 user message 提交

#### Scenario: 未命中任何 handler 时回退为普通消息
- **WHEN** 用户提交一段输入文本，且没有任何 slash handler 判定命中
- **THEN** 系统 SHALL 将该输入按普通 user message 提交

#### Scenario: command runtime 只负责命令运行态
- **WHEN** slash 命令启动或活跃 command session 处理输入事件
- **THEN** command runtime SHALL 负责 slash 路由、active command session、事件分发和 effect interpreter
- **THEN** command runtime SHALL NOT 负责为具体 handler 收集 AppContext 中的命令业务数据
