# hooks-command Specification

## Purpose
定义 `/hooks` slash command 的外部行为，包括 lifecycle hook 配置管理面板、entry 草稿编辑、保存 reload、synthetic test 入口，以及该命令与 transcript、provider、tool 和 runtime hook 流程的隔离。
## Requirements
### Requirement: /hooks command 展示 hooks 管理面板
系统 SHALL 提供 `/hooks` slash command，用 transient command surface 展示 lifecycle hook 事件和当前用户配置中的 hook entries。该面板 SHALL 用于管理配置，不得内嵌完整配置示例或完整 payload 字段文档。

#### Scenario: 打开 hooks 管理面板
- **WHEN** 用户提交 `/hooks`
- **THEN** 系统 SHALL 打开 hooks command session
- **THEN** composer SHALL 被清空并离开历史浏览状态
- **THEN** footer SHALL 显示 hooks 管理面板而不是普通 composer

#### Scenario: 展示支持的事件和配置状态
- **WHEN** hooks 管理面板打开
- **THEN** 面板 SHALL 展示所有支持的 lifecycle hook event
- **THEN** 面板 SHALL 通过 entry 列表或详情状态表达 hook entry 的 enabled/disabled 状态
- **THEN** 面板 SHALL NOT 展示当前配置文件路径

#### Scenario: 不展示长篇文档示例
- **WHEN** hooks 管理面板打开
- **THEN** 面板 SHALL NOT 展示完整 JSON 配置示例
- **THEN** 面板 SHALL NOT 展示完整 payload 字段文档
- **THEN** 面板 MAY 提供跳转外部 README/docs 的简短提示

#### Scenario: 展示配置诊断
- **WHEN** 用户级 hooks 配置包含未知 event 或无效 hook entry
- **THEN** hooks 管理面板 SHALL 以诊断形式展示被忽略的配置项摘要
- **THEN** 系统 SHALL NOT 因诊断打开而追加 transcript record

### Requirement: /hooks command 支持 hook entries 管理
hooks 管理面板 SHALL 支持在 command session 草稿中添加、编辑、启用/停用和删除 hook entries。保存前的操作 SHALL 只修改当前 command session 草稿，不得立即写入 `~/.echo/config.json` 或 reload hooks dispatcher。

#### Scenario: 选择 event 和 entry
- **WHEN** hooks 管理面板处于活跃状态
- **AND** 用户按 Up 或 Down
- **THEN** 系统 SHALL 在当前列表的可选行之间移动 selected index
- **THEN** 面板 SHALL 重新渲染当前选中项

#### Scenario: 添加 hook entry
- **WHEN** 用户在某个 lifecycle event 下添加 hook entry
- **THEN** 系统 SHALL 在当前 command session 草稿中创建新的 hook entry
- **THEN** 新 entry SHALL 至少包含 command 编辑字段、timeoutMs 草稿字段和 enabled 状态
- **THEN** 系统 SHALL NOT 立即写入 `~/.echo/config.json`

#### Scenario: 编辑 hook command
- **WHEN** 用户编辑某个 hook entry 的 command
- **THEN** 系统 SHALL 在当前 command session 草稿中更新该 command
- **THEN** 空 command SHALL 被视为待修正草稿或保存错误
- **THEN** 系统 SHALL NOT 立即执行该 command

#### Scenario: 编辑 hook timeout
- **WHEN** 用户编辑某个 hook entry 的 timeoutMs
- **THEN** 系统 SHALL 在当前 command session 草稿中更新该 timeoutMs
- **THEN** 保存时 timeoutMs SHALL 满足 lifecycle hooks 支持的范围约束
- **THEN** 系统 SHALL NOT 立即写入 `~/.echo/config.json`

#### Scenario: 启用或停用 hook entry
- **WHEN** 用户切换某个 hook entry 的 enabled 状态
- **THEN** 系统 SHALL 只更新当前 command session 草稿中的 enabled 状态
- **THEN** disabled entry SHALL 在保存后保留在配置中但不参与后续 lifecycle hook 执行

#### Scenario: 删除 hook entry
- **WHEN** 用户删除某个 hook entry
- **THEN** 系统 SHALL 从当前 command session 草稿中移除该 entry
- **THEN** 系统 SHALL NOT 立即写入 `~/.echo/config.json`

### Requirement: /hooks command 支持保存、取消和即时 reload
hooks 管理面板 SHALL 支持通过 entries 中的“添加 Hook”可选操作行新增配置，并通过 entries 与 entryDetail 中的“保存更改”可选操作行保存当前草稿并即时 reload lifecycle hooks 配置，支持 Esc 取消并丢弃未保存草稿。`a` SHALL NOT 作为添加快捷键，`s` SHALL NOT 作为保存快捷键。handler SHALL 通过 CommandHost 暴露的 hooks 领域能力完成配置读写和 reload，不得直接访问完整 AppContext、renderer、terminal 或 dispatcher 内部状态。

#### Scenario: 通过“保存更改”保存 hooks 草稿
- **WHEN** hooks 管理面板处于 entries 或 entryDetail 状态
- **AND** 用户选中“保存更改”操作行并按 Enter
- **THEN** 系统 SHALL 将 hooks 草稿保存到用户级配置的 `hooks` 节点
- **THEN** 系统 SHALL 保留用户级配置中的其它 root 节点
- **THEN** 系统 SHALL reload 当前 TUI 进程中的 lifecycle hook dispatcher
- **THEN** 后续 lifecycle hook event SHALL 使用保存后的配置

#### Scenario: entries 列表展示保存动作
- **WHEN** hooks 管理面板展示某个 event 下的 entries 列表
- **THEN** 面板 SHALL 展示“保存更改”可选操作行
- **THEN** 用户 SHALL 能通过 Up 或 Down 将焦点移动到该 action row
- **THEN** 用户 SHALL 能通过 Enter 触发保存

#### Scenario: entry detail 表单展示保存动作
- **WHEN** hooks 管理面板展示某个 entry 的详情
- **THEN** 面板 SHALL 展示 command、timeoutMs 和 enabled 字段
- **THEN** 面板 SHALL 将字段区与 synthetic test、delete 和 save 动作区视觉区分
- **THEN** 面板 SHALL 展示“保存更改”可选操作行
- **THEN** 用户 SHALL 能通过 Up 或 Down 将焦点移动到该 action row
- **THEN** 用户 SHALL 能通过 Enter 触发保存

#### Scenario: entries 列表通过操作行添加 Hook
- **WHEN** hooks 管理面板展示某个 event 下的 entries 列表
- **THEN** 面板 SHALL 展示“添加 Hook”可选操作行
- **THEN** 用户 SHALL 能通过 Up 或 Down 将焦点移动到该操作行
- **THEN** 用户按 Enter SHALL 新建 Hook 草稿并进入命令编辑态

#### Scenario: a 不再添加 Hook
- **WHEN** hooks 管理面板处于 events 或 entries 状态
- **AND** 用户按 `a`
- **THEN** 系统 SHALL NOT 新建 Hook 草稿
- **THEN** 系统 SHALL 保持当前 hooks command session 打开

#### Scenario: s 不再保存 hooks 草稿
- **WHEN** hooks 管理面板处于 events、entries 或 entryDetail 状态
- **AND** 用户按 `s`
- **THEN** 系统 SHALL NOT 保存 hooks 草稿
- **THEN** 系统 SHALL NOT reload lifecycle hook dispatcher
- **THEN** 系统 SHALL 保持当前 hooks command session 打开

#### Scenario: 保存校验失败
- **WHEN** 用户确认保存的 hooks 草稿包含空 command 或非法 timeoutMs
- **THEN** 系统 SHALL 保持 hooks command session 打开
- **THEN** 面板 SHALL 显示保存错误或字段诊断
- **THEN** 系统 SHALL NOT 写入无效 hooks 配置
- **THEN** 系统 SHALL NOT reload lifecycle hook dispatcher

#### Scenario: 取消 hooks 草稿
- **WHEN** hooks 管理面板处于活跃状态
- **AND** 用户按 Esc 取消
- **THEN** 系统 SHALL 丢弃当前 command session 草稿
- **THEN** 系统 SHALL NOT 写入 `~/.echo/config.json`
- **THEN** 系统 SHALL NOT reload lifecycle hook dispatcher
- **THEN** 系统 SHALL 关闭 hooks command session 并清空 composer

#### Scenario: handler 通过 host 管理 hooks
- **WHEN** `/hooks` command handler 需要读取、保存、reload 或测试 hooks
- **THEN** handler SHALL 调用 `CommandHost` 暴露的 hooks 领域能力
- **THEN** handler SHALL NOT 直接读取或写入用户配置文件
- **THEN** handler SHALL NOT 直接访问 lifecycle hook dispatcher 内部可变状态

### Requirement: /hooks command 支持 synthetic hook 测试
hooks 管理面板 SHALL 支持对单条 hook entry 执行 synthetic test。测试 SHALL 使用系统按 event 构造的 payload 执行 hook command，并 SHALL NOT 触发真实 assistant turn、tool call、tool execution 或 compaction。

#### Scenario: 使用 synthetic payload 测试 hook
- **WHEN** 用户选择某个 hook entry 并启动测试
- **THEN** 系统 SHALL 根据该 entry 所属 lifecycle event 构造 synthetic payload
- **THEN** payload SHALL 包含 event、timestamp、cwd 和该 event 所需的稳定测试字段
- **THEN** 系统 SHALL 使用当前 cwd 作为 hook 测试进程的工作目录
- **THEN** 系统 SHALL 设置 `ECHO_HOOK_EVENT` 和 `ECHO_HOOK_CWD` 环境变量
- **THEN** 系统 SHALL 将 synthetic payload JSON 写入测试进程 stdin

#### Scenario: 测试不触发真实生命周期
- **WHEN** 用户执行 hook synthetic test
- **THEN** 系统 SHALL NOT 提交用户消息或启动 assistant turn
- **THEN** 系统 SHALL NOT 执行真实 tool call 或 tool approval 流程
- **THEN** 系统 SHALL NOT 执行自动或手动 compaction
- **THEN** 系统 SHALL NOT 派发额外 lifecycle hook event

#### Scenario: 展示 hook 测试结果
- **WHEN** hook synthetic test 运行或完成
- **THEN** hooks command surface SHALL 以短状态展示 synthetic test 进度或结果
- **THEN** 状态 SHALL 区分 running、ok、failed 和 timeout
- **THEN** hooks command surface SHALL NOT 展示 verbose synthetic output
- **THEN** 系统 SHALL 保持当前 hooks command session 可继续操作

#### Scenario: 测试输出不进入持久状态
- **WHEN** hook synthetic test 产生 stdout 或 stderr
- **THEN** 系统 SHALL NOT 将测试输出追加为 transcript record
- **THEN** 系统 SHALL NOT 将测试输出保存到 session
- **THEN** 系统 SHALL NOT 将测试输出作为 provider request 输入或 tool result 回传模型

#### Scenario: 测试超时
- **WHEN** hook synthetic test 运行超过该 entry 的 timeoutMs
- **THEN** 系统 SHALL 终止测试进程
- **THEN** hooks command surface SHALL 展示 timeout 结果
- **THEN** 系统 SHALL 保持当前 hooks command session 可继续操作

### Requirement: /hooks command 注册和提示
系统 SHALL 将 `/hooks` 注册到默认 slash command handlers，并在 slash suggestions 和 `/help` 可见的命令描述中暴露该命令。

#### Scenario: 默认命令集合包含 hooks command
- **WHEN** 系统创建默认 slash command handlers
- **THEN** handlers SHALL 包含 `/hooks` command
- **THEN** slash command descriptors SHALL 包含 `/hooks` 的说明

#### Scenario: /hooks 不匹配带参数的未知输入
- **WHEN** 用户提交 `/hooks` 以外的 slash 输入
- **THEN** `/hooks` handler SHALL NOT 错误消费其它 slash command
- **THEN** command runtime SHALL 继续按既有 slash command 解析顺序处理该输入

### Requirement: /hooks command 支持长 command 横向查看
/hooks entry detail SHALL allow users to inspect hook command values that exceed the visible cell width. When the command detail row is focused and not in edit mode, horizontal navigation SHALL change the visible command window instead of permanently truncating only the tail.

#### Scenario: 长 command 可以向右查看
- **WHEN** hooks 管理面板展示某个 entry 的详情
- **AND** 该 entry 的 command 超过当前可见宽度
- **AND** 当前焦点位于 command 行且未处于编辑态
- **AND** 用户按 Right
- **THEN** 面板 SHALL 向右移动 command 的可见窗口
- **THEN** 面板 SHALL 显示 command 后续内容
- **THEN** 系统 SHALL NOT 修改 hook entry 草稿中的 command 文本

#### Scenario: 长 command 可以向左查看
- **WHEN** command 行已经向右滚动显示中间或尾部内容
- **AND** 用户按 Left
- **THEN** 面板 SHALL 向左移动 command 的可见窗口
- **THEN** 系统 SHALL NOT 修改 hook entry 草稿中的 command 文本

#### Scenario: command 截断状态可识别
- **WHEN** command 行只显示完整 command 的一部分
- **THEN** 面板 SHALL 使用省略号或等价提示表达左侧或右侧仍有隐藏内容
- **THEN** 面板 SHALL 保持右边框和当前 footer 宽度对齐

#### Scenario: 编辑长 command 时可移动光标
- **WHEN** 用户正在编辑超过可见宽度的 command
- **AND** 用户按 Left、Right、Home 或 End
- **THEN** 系统 SHALL 移动 command 编辑光标而不提交草稿
- **THEN** command 可见窗口 SHALL 跟随光标并展示光标附近文本
- **THEN** 用户输入、Backspace 或 Delete SHALL 在当前光标位置修改文本
- **THEN** 面板 SHALL 使用左侧或右侧省略号表达窗口外仍有隐藏内容

#### Scenario: 横向查看状态在切换上下文时重置
- **WHEN** 用户切换 event、切换 entry、进入 command 编辑态或退出 entry detail
- **THEN** 系统 SHALL 重置 command 横向查看位置
- **THEN** 后续重新进入 entry detail 时 SHALL 从 command 开头显示
