## ADDED Requirements

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

## MODIFIED Requirements

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
