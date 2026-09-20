# startup-auto-update Specification

## Purpose
定义 echo-tui 启动更新检测与前台自更新的外部行为：检查触发时机、资格与开关边界、registry 请求与缓存、更新提示的呈现门控与交互，以及稍后提醒和忽略版本的持久化语义。

## Requirements
### Requirement: 启动更新检查
系统 SHALL 在 TUI 首帧渲染完成后异步执行更新检查，SHALL NOT 阻塞启动，SHALL NOT 写入 transcript 或进入 provider 请求；`--once` 等 headless 路径 SHALL NOT 执行更新检查。检查 SHALL 只对包管理器安装的副本生效：从源码目录运行（`npm start`、`npm link`）或从 npx 缓存运行时 SHALL 跳过；`updates.checkOnStartup` 为 false 时 SHALL 关闭检查。检查 SHALL 请求 npm registry（优先 `npm_config_registry`，缺省官方源）的 `@eumendies/echo-tui` latest 版本并设置超时；网络失败、超时或响应非法时 SHALL 静默降级且 SHALL NOT 呈现提示。当 registry latest 的版本号高于当前版本且不等于已忽略版本时，系统 SHALL 进入可提示状态。

#### Scenario: 首帧渲染后异步检查
- **WHEN** 用户启动 TUI 且资格判定与开关允许检查
- **THEN** 系统 SHALL 在首帧渲染完成之后开始检查，SHALL NOT 让首帧等待网络结果
- **THEN** 检查 SHALL NOT 写入 transcript record，SHALL NOT 进入 provider 请求上下文

#### Scenario: headless 路径不检查
- **WHEN** 用户运行 `echo-tui --once <prompt>`
- **THEN** 系统 SHALL NOT 执行更新检查，SHALL NOT 创建更新提示状态

#### Scenario: 源码运行与 npx 缓存跳过
- **WHEN** 用户从源码目录运行 TUI（`npm start`）或经 npx 缓存运行
- **THEN** 系统 SHALL 跳过更新检查且 SHALL NOT 呈现任何更新提示

#### Scenario: 配置关闭检查
- **WHEN** `updates.checkOnStartup` 为 false
- **THEN** 系统 SHALL 跳过更新检查且 SHALL NOT 发起 registry 请求

#### Scenario: 重启窗口内跳过重新提示
- **WHEN** 更新流程在重启前记录了短窗口防重弹标记，且当前时间仍处于该窗口内
- **THEN** 启动检查 SHALL 返回跳过，SHALL NOT 重新提示版本，也 SHALL NOT 发起 registry 请求

#### Scenario: 检查失败静默降级
- **WHEN** registry 请求超时、网络失败、返回非 2xx 或响应缺少合法版本号
- **THEN** 系统 SHALL 静默结束检查，SHALL NOT 呈现提示或报错 surface
- **THEN** TUI SHALL 正常运行，且 SHALL NOT 刷新最近成功检查时间

#### Scenario: 发现新版本进入可提示状态
- **WHEN** registry 的 latest 版本号高于当前版本且不等于已忽略版本
- **THEN** 系统 SHALL 记录可提示状态并等待呈现门控满足后展示提示

### Requirement: 更新提示 surface
可提示状态且呈现门控满足时，系统 SHALL 以 choice surface 呈现更新提示，包含中文标题（如「更新可用」）、当前版本与最新版本说明、按序排列的三个选项 `立即更新`、`稍后提醒`、`忽略此版本` 及各自描述，以及键位提示。默认键盘焦点 SHALL 位于「稍后提醒」（提示为自动弹出，避免误触 Enter 直接触发退出与全局安装）。↑/↓ SHALL 移动焦点，Enter SHALL 确认当前选项，Esc SHALL 等同「稍后提醒」。提示 SHALL 不写入 transcript，SHALL NOT 切换 alternate screen，SHALL 使用既有 footer surface 与 ANSI 渲染机制。

#### Scenario: 提示内容与选项
- **WHEN** 可提示状态就绪且呈现门控满足
- **THEN** footer SHALL 显示 choice 卡片而不是 composer
- **THEN** 卡片 SHALL 显示标题、当前版本与最新版本说明、三个中文选项与描述、键位提示

#### Scenario: 默认焦点与键位
- **WHEN** 更新提示出现
- **THEN** 默认键盘焦点 SHALL 位于「稍后提醒」
- **THEN** ↑/↓ SHALL 在选项间移动焦点，Enter SHALL 确认当前选项，Esc SHALL 触发与「稍后提醒」相同的决策

#### Scenario: 提示不写 transcript
- **WHEN** 更新提示出现、移动焦点或关闭
- **THEN** transcript SHALL NOT 新增任何记录

### Requirement: 更新提示的呈现门控与输入优先级
系统 SHALL 仅在用户空闲时呈现更新提示：存在进行中的 assistant turn、shell 命令、pending 消息、会话引用准备或总结、用户问题、工具审批、文件选择、其它 modal、command session、subagent 视图、BTW 会话、model tuning 面板或本地错误 surface 时 SHALL NOT 呈现；composer 非空或最近 1 秒内存在 stdin 输入时 SHALL NOT 呈现；MCP bootstrap 完成前 SHALL NOT 呈现。门控不满足时系统 SHALL 保持待命并在后续时机重试，SHALL NOT 以降级形式（toast、transcript 记录、状态行常驻提示）打扰用户。提示激活期间 SHALL 以最低优先级 modal 参与输入路由：优先级低于用户问题、工具审批与文件选择，并 SHALL 消费所有输入直到用户做出决策。

#### Scenario: 用户正在输入时不打断
- **WHEN** 检查发现新版本但 composer 非空，或最近 1 秒内存在 stdin 输入
- **THEN** 系统 SHALL NOT 呈现提示，SHALL 保持待命并稍后重试

#### Scenario: 回合与其它交互活跃时延后
- **WHEN** assistant turn、shell 命令、command session 或其它 modal 处于活跃状态
- **THEN** 系统 SHALL NOT 呈现提示
- **THEN** 相关活动结束且门控满足后，系统 SHALL 再呈现提示

#### Scenario: 输入优先级最低
- **WHEN** 更新提示与其它 modal（用户问题、工具审批、文件选择）同时可能消费输入
- **THEN** 其它 modal SHALL 优先消费输入，更新提示 SHALL NOT 抢先响应

#### Scenario: 长会话始终不空闲
- **WHEN** 本次会话中呈现门控始终未满足
- **THEN** 系统 SHALL 保持待命且 SHALL NOT 强行呈现提示，直到会话结束

### Requirement: 立即更新与自动重启
用户选择「立即更新」时，系统 SHALL 先完成终端收尾（移除 stdin 与 resize 监听、暂停 stdin、停止周期重绘、清理 footer、退出 raw mode、恢复光标可见性），SHALL NOT 在 npm 与重启进程运行期间继续消费输入、响应 resize 或重绘 TUI，SHALL NOT 切换 alternate screen。随后系统 SHALL 在前台执行 `npm install -g @eumendies/echo-tui@latest`，npm 的 stdout/stderr SHALL 直接透传用户终端。安装成功后系统 SHALL 自动重启 echo-tui：使用当前 Node 可执行文件与入口脚本、保持当前工作目录、继承标准输入输出，并 SHALL 以重启进程的退出码退出；重启前系统 SHALL 记录短窗口防重弹标记，使重启进程在窗口内跳过重新提示。安装失败时系统 SHALL 输出可读错误与手动安装命令，并 SHALL 以当前版本重启。重启无法启动时系统 SHALL 输出手动重启提示并以非零状态退出。

#### Scenario: 前台安装成功后重启新版本
- **WHEN** 用户选择「立即更新」且 `npm install -g @eumendies/echo-tui@latest` 成功退出
- **THEN** 系统 SHALL 输出更新完成说明并自动启动 echo-tui
- **THEN** 重启前 SHALL 记录短窗口防重弹标记，重启进程在窗口内 SHALL NOT 重新提示；原进程 SHALL 以重启进程的退出码退出

#### Scenario: npm 输出直接可见
- **WHEN** 前台更新命令运行
- **THEN** npm 的输出 SHALL 写入用户终端而不是被 TUI footer 接管或吞掉

#### Scenario: 收尾后父进程让出终端
- **WHEN** 前台更新命令或重启进程运行期间终端收到输入或发生 resize
- **THEN** 原进程 SHALL NOT 消费该输入，SHALL NOT 响应 resize 触发重绘
- **THEN** 终端输入与显示 SHALL 由前台子进程独占

#### Scenario: 安装失败以当前版本重启
- **WHEN** 前台更新命令以非零码退出（例如权限不足或网络失败）
- **THEN** 系统 SHALL 输出可读错误与手动安装命令提示
- **THEN** 系统 SHALL 以当前版本重新启动 echo-tui

#### Scenario: 重启无法启动
- **WHEN** 安装成功但重启 echo-tui 进程失败
- **THEN** 系统 SHALL 输出手动重启提示并以非零状态退出

#### Scenario: 终端收尾无残留
- **WHEN** 用户选择「立即更新」
- **THEN** 系统 SHALL 退出 raw mode 并清理 footer 与光标状态
- **THEN** 系统 SHALL NOT 输出进入或离开 alternate screen 的 ANSI 序列

### Requirement: 稍后提醒与忽略版本
「稍后提醒」SHALL 只抑制本次会话中的提示且 SHALL NOT 持久化；进程退出后系统 SHALL NOT 认为该版本已被忽略。「忽略此版本」SHALL 将被忽略版本持久化到更新状态文件，仅对该版本抑制提示；当 registry latest 高于被忽略版本时系统 SHALL 恢复提示。忽略写入失败时系统 SHALL 至少保证本次会话不再提示，SHALL NOT 因持久化失败阻塞或报错打扰用户。

#### Scenario: 稍后提醒仅作用于本次会话
- **WHEN** 用户选择「稍后提醒」或按 Esc
- **THEN** 本次会话 SHALL 不再呈现该提示
- **THEN** 用户重新启动 echo-tui 后，若仍发现新版本 SHALL 再次提示

#### Scenario: 忽略此版本被持久化
- **WHEN** 用户选择「忽略此版本」
- **THEN** 系统 SHALL 将被忽略版本写入更新状态文件
- **THEN** 后续检查发现同一版本时 SHALL NOT 呈现提示

#### Scenario: 更高版本恢复提示
- **WHEN** registry latest 高于已忽略版本
- **THEN** 系统 SHALL 重新进入可提示状态并呈现提示

#### Scenario: 忽略写入失败降级
- **WHEN** 更新状态文件不可写
- **THEN** 系统 SHALL 至少保证本次会话不再提示该版本
- **THEN** 系统 SHALL NOT 因写入失败打断会话或显示错误 surface

### Requirement: 更新状态文件与缓存
系统 SHALL 将成功检查结果写入 `~/.echo/update-state.json`，包含最近成功检查时间、最新版本与已忽略版本字段；写入 SHALL 使用同目录临时文件加 rename 原子替换；文件缺失、损坏或字段非法时 SHALL 按无状态处理，SHALL NOT 阻断 TUI 启动或提示流程。距最近成功检查时间未满 24 小时时，系统 SHALL 使用缓存的最新版本结论且 SHALL NOT 发起新的 registry 请求；检查失败 SHALL NOT 刷新最近成功检查时间。

#### Scenario: 成功检查写入状态文件
- **WHEN** 一次 registry 检查成功
- **THEN** 系统 SHALL 更新最近成功检查时间与最新版本，并保留已有忽略版本
- **THEN** 写入 SHALL 通过临时文件加 rename 完成，SHALL NOT 触发 `~/.echo/config.json` 的配置变更通知

#### Scenario: 缓存窗口内不重复联网
- **WHEN** 距最近成功检查未满 24 小时且缓存中存在最新版本
- **THEN** 系统 SHALL 直接使用缓存结论
- **THEN** 系统 SHALL NOT 发起新的 registry 请求

#### Scenario: 失败不刷新检查时间
- **WHEN** 一次 registry 检查失败
- **THEN** 系统 SHALL NOT 更新最近成功检查时间
- **THEN** 下次启动 MAY 重新发起检查

#### Scenario: 状态文件损坏容错
- **WHEN** `~/.echo/update-state.json` 缺失、JSON 损坏或字段类型非法
- **THEN** 系统 SHALL 按无状态处理（无缓存、无忽略版本）
- **THEN** TUI SHALL 正常启动，检查流程 SHALL 不受阻断

