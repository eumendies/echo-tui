## Requirements

### Requirement: 沙箱配置 Tab 与面板布局
系统 SHALL 在 `/config` 配置中心提供「沙箱」Tab，位于「模型与 Provider」之后、「外观」之前。面板 SHALL 按当前草稿展示沙箱档位、网络访问开关、逐条额外可写目录、新增目录入口与保存动作。纯 `/config` SHALL 仍默认打开「常规」Tab。

#### Scenario: 打开沙箱 Tab 显示草稿
- **WHEN** 用户在配置中心切换到「沙箱」Tab
- **THEN** 面板 SHALL 显示当前 `tools.sandbox` 草稿
- **THEN** 面板 SHALL NOT 写入 transcript 或启动 agent loop

#### Scenario: 配置文件缺失时读取缺省草稿
- **WHEN** `~/.echo/config.json` 不存在且用户打开「沙箱」Tab
- **THEN** 系统 SHALL 以默认策略（`workspace-write`、网络开启、空目录列表）初始化草稿
- **THEN** 用户 SHALL 能直接编辑并保存（保存时创建配置文件）

### Requirement: 沙箱档位草稿编辑
系统 SHALL 支持在「沙箱」Tab 用左右方向键在三档间循环：`off` → `read-only` → `workspace-write` → `off`，并以中文档位名展示（关闭 / 只读 / 工作区可写）。档位编辑 SHALL 只作用于草稿，保存前 SHALL NOT 写入配置文件。

#### Scenario: 档位循环切换
- **WHEN** 焦点在档位行且用户按右方向键
- **THEN** 档位 SHALL 按循环顺序前进一档，按左方向键后退一档
- **THEN** Tab 条 SHALL 将沙箱 Tab 标记为 dirty

### Requirement: 网络访问草稿切换
系统 SHALL 支持用左右方向键或 Enter 在「允许网络访问」行切换开 / 关。该值表示配置原值；`read-only` 档在运行时恒为禁网的归一化语义属于 `bash-sandbox` 能力。

#### Scenario: 切换网络开关
- **WHEN** 焦点在网络行且用户按左 / 右方向键或 Enter
- **THEN** 草稿 network SHALL 在开 / 关之间翻转

### Requirement: 额外可写目录草稿编辑
系统 SHALL 逐行展示 `extraWritablePaths`，Enter 移除选中目录。「+ 添加可写目录」行 Enter 进入行内输入：TEXT 事件追加字符、BACKSPACE 删除字符、Esc 取消返回列表。确认时系统 SHALL 校验路径为非空绝对路径且与既有条目不重复；非法输入 SHALL 就地报错且不修改草稿。

#### Scenario: 行内输入添加目录
- **WHEN** 用户在「+ 添加可写目录」行按 Enter，输入 `/Users/me/code` 后按 Enter 确认
- **THEN** 草稿 `extraWritablePaths` SHALL 追加 `/Users/me/code`
- **THEN** 面板 SHALL 返回列表模式并展示新目录

#### Scenario: 非法路径被拒绝
- **WHEN** 用户输入相对路径（如 `./build`）并按 Enter 确认
- **THEN** 面板 SHALL 就地显示"路径必须是绝对路径"类错误
- **THEN** 草稿 SHALL NOT 变化且输入缓冲 SHALL 保留供修正

#### Scenario: Enter 移除目录
- **WHEN** 焦点在某条目录行且用户按 Enter
- **THEN** 该目录 SHALL 从草稿移除

### Requirement: 沙箱设置保存与即时生效
保存动作 SHALL 经 `host.config.saveSandboxDraft` 原子写入 `~/.echo/config.json` 的 `tools.sandbox` 并发布新配置 revision；档位、网络与额外可写目录按草稿原值落盘。保存成功 SHALL 显示成功反馈并重置脏状态；写盘失败 SHALL 就地显示错误且配置文件保持不变。保存后系统 SHALL 在下一条 bash 命令按新配置解析沙箱，无需重启；`read-only` 档 SHALL 照存 `extraWritablePaths` 但运行时忽略（provider 既有语义）。

#### Scenario: 保存成功
- **WHEN** 用户在保存行按 Enter 且草稿合法
- **THEN** 系统 SHALL 将 `tools.sandbox` 原子写入配置文件
- **THEN** 面板 SHALL 显示成功反馈，Tab 条 dirty 标记 SHALL 消失

#### Scenario: 保存后下一条命令即时生效
- **WHEN** 保存将档位改为 `read-only` 后用户执行一条 bash 命令
- **THEN** 该命令 SHALL 按新档位包装执行（工作区只读、禁网），无需重启
- **THEN** `/status` 沙箱行 SHALL 反映新档位

#### Scenario: 保存失败不落盘
- **WHEN** 写入配置文件失败（如磁盘只读）
- **THEN** 面板 SHALL 就地显示错误
- **THEN** 配置文件内容 SHALL 保持不变

### Requirement: 沙箱 Tab 脏草稿保护
未保存的沙箱草稿修改 SHALL 使 Tab 条显示 dirty 标记；用户按 Esc 关闭配置中心时，系统 SHALL 弹出统一放弃确认（继续编辑 / 放弃更改），放弃前 SHALL NOT 写入任何配置。

#### Scenario: Esc 触发放弃确认
- **WHEN** 沙箱草稿存在未保存修改且用户按 Esc
- **THEN** 系统 SHALL 显示放弃确认并列出「沙箱」
- **THEN** 选择放弃 SHALL 关闭配置中心且不写配置文件
