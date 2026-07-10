## MODIFIED Requirements

### Requirement: 用户级 lifecycle hooks 配置
系统 SHALL 支持从用户级配置读取可选 lifecycle hooks 配置。配置 SHALL 允许用户按事件名配置一个或多个本地 hook 命令。Hook entry SHALL 支持字符串 shorthand 和对象格式；对象格式 SHALL 支持 command、timeoutMs 和可选 enabled 字段。未配置 hooks、hooks 配置缺失、单个 hook entry 无效或 hook entry 被 disabled 时，系统 SHALL 保持现有 assistant、tool、compaction 和 TUI 行为不变。

#### Scenario: 未配置 hooks 时行为不变
- **WHEN** 用户级配置中不存在 `hooks` 节点
- **THEN** 系统 SHALL 不创建可执行 hook job
- **THEN** 普通 assistant turn、tool execution、compaction、transcript persistence 和 TUI rendering SHALL 保持既有行为

#### Scenario: 读取有效 hook 配置
- **WHEN** 用户级配置中为 `assistant_turn_end` 配置了一个有效本地命令
- **THEN** 系统 SHALL 在 `assistant_turn_end` 事件发生时 enqueue 对应 hook job
- **THEN** 系统 SHALL 使用当前工作目录作为 hook job 的工作目录

#### Scenario: 读取对象格式 hook 配置
- **WHEN** 用户级配置中某个 hook entry 使用对象格式并包含有效 command 与 timeoutMs
- **THEN** 系统 SHALL 将该 entry 作为可执行 hook entry 读取
- **THEN** 未设置 enabled 字段的对象 entry SHALL 被视为 enabled

#### Scenario: disabled hook entry 不执行
- **WHEN** 用户级配置中某个 hook entry 设置 `enabled` 为 `false`
- **THEN** 系统 SHALL 保留该配置用于管理视图读取
- **THEN** lifecycle hook dispatcher SHALL NOT 为该 disabled entry 创建可执行 hook job
- **THEN** 普通 assistant turn、tool execution、compaction、transcript persistence 和 TUI rendering SHALL 保持既有行为

#### Scenario: 忽略无效 hook entry
- **WHEN** 用户级配置中的某个 hook entry 缺少可执行命令、事件名未知或字段类型无效
- **THEN** 系统 SHALL 忽略该 hook entry
- **THEN** 系统 SHALL NOT 因该无效 hook entry 阻止 CLI 启动或 assistant turn 执行
- **THEN** 系统 SHALL NOT 为该配置错误追加 transcript record

## ADDED Requirements

### Requirement: lifecycle hooks 配置草稿和诊断
系统 SHALL 提供面向管理命令的 hooks 配置草稿读取能力。草稿读取 SHALL 保留可管理的 hook entries、enabled 状态、entry 顺序和配置诊断；该能力 SHALL NOT 改变 runtime hook 执行语义。

#### Scenario: 读取管理草稿
- **WHEN** 管理命令读取 hooks 配置草稿
- **THEN** 系统 SHALL 从用户级配置的 `hooks` 节点读取所有支持 event 的 hook entries
- **THEN** 系统 SHALL 保留每个有效 entry 的 command、timeoutMs、enabled 状态和原始顺序
- **THEN** 系统 SHALL 将字符串 shorthand 归一化为 enabled 草稿 entry

#### Scenario: 读取配置诊断
- **WHEN** 用户级 hooks 配置包含未知 event、无效 entry、空 command 或非法 timeoutMs
- **THEN** 管理草稿 SHALL 包含对应配置诊断摘要
- **THEN** runtime hooks SHALL 继续忽略无效配置
- **THEN** 系统 SHALL NOT 因读取诊断追加 transcript record

#### Scenario: 保存管理草稿
- **WHEN** 管理命令保存 hooks 配置草稿
- **THEN** 系统 SHALL 只替换用户级配置的 `hooks` 节点
- **THEN** 系统 SHALL 保留用户级配置中的 llm、mcp、theme 或其它 root 节点
- **THEN** 保存后的 disabled entries SHALL 使用对象格式保留 enabled 状态

### Requirement: lifecycle hook dispatcher 支持配置 reload
系统 SHALL 支持在当前 TUI 进程中更新 lifecycle hook dispatcher 的运行配置。配置 reload SHALL 影响后续 lifecycle event 的 hook job 入队，不得修改已经入队或正在运行的 hook job。

#### Scenario: reload 后使用新配置
- **WHEN** hooks 配置被保存并 reload 到 dispatcher
- **THEN** 后续 lifecycle hook event SHALL 使用 reload 后的 enabled hook entries
- **THEN** disabled entries SHALL NOT 在后续 lifecycle hook event 中入队执行

#### Scenario: reload 不影响已入队任务
- **WHEN** lifecycle hook dispatcher 已经存在排队或运行中的 hook job
- **AND** hooks 配置在该 job 完成前被 reload
- **THEN** 已入队或正在运行的 hook job MAY 继续使用入队时的 command、timeoutMs 和 payload
- **THEN** reload SHALL NOT 尝试终止或重写正在运行的 hook 子进程

#### Scenario: reload 失败不破坏现有配置
- **WHEN** hooks 配置保存或 reload 失败
- **THEN** lifecycle hook dispatcher SHALL 保持最后一次成功加载的运行配置
- **THEN** 系统 SHALL NOT 将 reload 失败追加为 transcript record

### Requirement: lifecycle hook synthetic test 执行入口
系统 SHALL 提供受控的 hook synthetic test 执行入口，用于验证单条 hook command 在 lifecycle hook 执行契约下是否可运行。Synthetic test SHALL 使用测试 payload，不得触发真实 lifecycle event 或改变 transcript、session、provider request、tool result、tool approval 或 compaction 状态。

#### Scenario: synthetic test 使用 hook 执行契约
- **WHEN** 系统执行某条 hook entry 的 synthetic test
- **THEN** 系统 SHALL 使用指定 cwd 作为测试进程工作目录
- **THEN** 系统 SHALL 设置 `ECHO_HOOK_EVENT` 和 `ECHO_HOOK_CWD` 环境变量
- **THEN** 系统 SHALL 将 synthetic payload JSON 写入测试进程 stdin
- **THEN** 系统 SHALL 对测试进程应用该 entry 的 timeoutMs

#### Scenario: synthetic payload 字段
- **WHEN** 系统为某个 lifecycle event 构造 synthetic payload
- **THEN** payload SHALL 包含 event、timestamp 和 cwd
- **THEN** assistant turn events 的 payload SHALL 包含 interaction mode 和测试 status
- **THEN** tool call events 的 payload SHALL 包含测试 tool call id、tool name，并按 event 类型包含 arguments text 或 ok 状态
- **THEN** compaction event 的 payload SHALL 包含测试 activeStartIndex 和 createdAt

#### Scenario: synthetic test 捕获 bounded 输出
- **WHEN** synthetic test 进程产生 stdout 或 stderr
- **THEN** 测试执行入口 SHALL 捕获 bounded stdout 和 stderr 供调用方展示
- **THEN** 捕获输出 SHALL 被截断到实现定义的安全上限
- **THEN** 捕获输出 SHALL NOT 被追加到 transcript、session 或 provider request

#### Scenario: synthetic test 失败隔离
- **WHEN** synthetic test 进程启动失败、返回非零退出码或超时
- **THEN** 测试执行入口 SHALL 返回失败、exit code 或 timeout 结果
- **THEN** 系统 SHALL NOT 因测试失败中断当前 assistant turn、tool execution 或 compaction 流程
- **THEN** 系统 SHALL NOT 因测试失败追加 error transcript record
