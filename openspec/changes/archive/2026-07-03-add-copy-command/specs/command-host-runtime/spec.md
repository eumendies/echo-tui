## ADDED Requirements

### Requirement: CommandHost 暴露复制命令所需能力
系统 SHALL 通过 `CommandHost` 向 `/copy` command handler 暴露受控的可复制 transcript 读取能力和剪贴板写入能力。handler SHALL NOT 直接访问完整 `AppContext`、renderer、terminal controller 或系统剪贴板命令实现。

#### Scenario: handler 通过 host 读取可复制消息
- **WHEN** `/copy` command handler 需要构建复制面板
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 transcript 复制读取能力获取 user/assistant 消息快照
- **THEN** handler SHALL NOT 直接遍历完整 `AppContext` 或 transcript store 内部对象

#### Scenario: handler 通过 host 写入剪贴板
- **WHEN** `/copy` command handler 确认复制选中消息
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 clipboard 能力写入文本
- **THEN** handler SHALL NOT 直接执行 `pbcopy`、`clip`、`wl-copy`、`xclip`、`xsel` 或其他系统命令

#### Scenario: command runtime 不解释复制业务 effect
- **WHEN** `/copy` command 读取消息、更新选择、确认复制或处理失败
- **THEN** command handler SHALL 直接调用 `CommandHost` 或更新 command session
- **THEN** `CommandRuntime` SHALL NOT 为复制流程新增业务 effect interpreter 分支

### Requirement: 剪贴板写入结果结构化
系统 SHALL 将剪贴板写入结果表达为结构化成功或失败结果，使 command handler 可以展示稳定的用户反馈。失败结果 SHALL 包含可读错误信息或失败原因。

#### Scenario: 剪贴板写入成功
- **WHEN** host clipboard 能力成功写入文本
- **THEN** 该能力 SHALL 返回成功结果
- **THEN** `/copy` command handler SHALL 能据此关闭 command session 并展示成功反馈

#### Scenario: 剪贴板写入失败
- **WHEN** host clipboard 能力无法找到可用剪贴板工具或写入过程失败
- **THEN** 该能力 SHALL 返回失败结果
- **THEN** 失败结果 SHALL 包含可展示给用户的原因
- **THEN** `/copy` command handler SHALL 能据此保持 surface 打开并展示失败提示
