# background-bash-tasks Specification

## Purpose
定义后台 Bash 任务的文件查询协议、运行管理与资源上限、turn/会话/退出生命周期、本地通知，以及 `/tasks` 面板与 transcript 投影。
## Requirements
### Requirement: 后台 Bash 复用文件读取协议

系统 SHALL 允许交互式主会话通过 `run_bash_command` 的 `background: true` 启动受管理的非交互命令。系统 SHALL 返回启动状态、日志文件与状态文件的绝对路径，并说明通过已有 `read_files` 查询；内部任务身份 SHALL NOT 进入模型可见文本。系统 SHALL NOT 为查询、等待或停止后台任务增加 provider-visible 工具名称。

#### Scenario: 后台启动不等待命令结束
- **WHEN** 通过权限检查的后台命令成功创建文件并启动
- **THEN** 工具 SHALL 在命令仍可运行时返回任务引用，允许 agent 继续执行后续工作
- **AND** 返回的日志和状态路径 SHALL 已存在且能通过 `read_files` 读取
- **AND** `ok: true` SHALL 仅表示启动成功，不声明命令 exit code 为 0
- **AND** 启动结果文本 SHALL 仅提供任务元信息、文件路径和查询指引，不包含 stdout/stderr 正文
- **AND** tool_result.details SHALL 保存 task_id、session_id、owner_instance_id、output_path、status_path，供历史任务投影和 undo 按三元身份定位

#### Scenario: 快速完成保留真实状态
- **WHEN** 命令在启动交接完成前已经自然退出
- **THEN** 返回引用 SHALL 指向该任务已落盘的实际终态和日志
- **AND** 系统 SHALL NOT 将非零退出伪装成命令成功

#### Scenario: 模型查询结果
- **WHEN** 模型通过 `read_files` 读取返回的状态与日志路径
- **THEN** 状态 SHALL 提供运行情况和已知退出信息，日志 SHALL 提供该命令已采集输出
- **AND** 读取 SHALL 继续使用既有 offset/limit 与工具输出预算
- **AND** 系统 SHALL NOT 要求模型安装扩展或调用新增管理工具

#### Scenario: 工具说明约束使用时机
- **WHEN** 系统向模型提供后台 Bash 能力说明
- **THEN** 工具 description SHALL 保持原有前台文案，不为后台能力扩张常驻 schema 成本
- **AND** background 参数 SHALL 只用一句话说明它会返回日志/状态路径，而不是解释何时该使用
- **AND** 启动成功不等于执行成功、运行中日志末尾不代表结束等细节 SHALL 只出现在启动结果文本中

### Requirement: 任务状态快照具有确定语义

系统 SHALL 为每个后台任务维护版本化 `status.json`，至少包含 version、task_id、session_id、owner_instance_id、command、cwd、state、started_at、finished_at、exit_code、signal、reason、output_path、output_truncated。未知退出码和未结束时间 SHALL 使用 null。状态 SHALL 仅区分 running、stopping、exited、stopped、failed，SHALL 使用原子替换发布完整 JSON。历史未托管 SHALL 是引用投影分类，不另设没有触发条件的持久化状态。

#### Scenario: 正常或失败退出
- **WHEN** 命令自然退出并且输出完成收尾
- **THEN** 状态 SHALL 为 exited，保存真实退出码和结束时间
- **AND** 非零 exit_code SHALL 表达命令失败，不依赖日志中是否出现 error 字样
- **AND** 终态发布后，该任务的 output.log SHALL 不再因正常采集而增长

#### Scenario: 停止不是自然完成
- **WHEN** 用户停止、硬超时、日志上限或会话清理触发任务终止
- **THEN** 终止期间状态 SHALL 不宣称已经结束
- **AND** 收尾后状态 SHALL 为 stopped，并记录 user_stop、timeout、output_limit 或 session_cleanup 等明确原因
- **AND** 系统 SHALL NOT 用 exit_code 0 冒充被终止命令的成功结果

#### Scenario: 运行中并发读取
- **WHEN** `read_files` 恰好在运行时更新状态时读取 status.json
- **THEN** 它 SHALL 读到完整旧快照或完整新快照，而不是部分 JSON
- **AND** 无日志增长或日志读到 EOF SHALL NOT 被状态协议解释为命令已结束

#### Scenario: 清理期限内无法确认进程结束
- **WHEN** 已尝试终止任务但清理总期限到达后仍未确认进程结束
- **THEN** 系统 SHALL 关闭本地采集，尽力写入 failed、reason 为 cleanup_timeout、exit_code 为 null 的快照
- **AND** UI SHALL 明确执行结果未知，不宣称任务已停止或成功退出
- **AND** 可能写入任务的当前会话 undo 保护 SHALL 保留，不因本地停止等待而释放

### Requirement: 后台日志在运行时可读且资源有界

系统 SHALL 从启动开始追加写入 output.log，按运行时接收顺序合并 stdout/stderr，提供可供 `read_files` 读取的规范化 UTF-8 文本。系统 SHALL 移除 NUL，将原文或解码产生的 U+FFFD 转为可见转义文本，并在单个物理行超过 4096 UTF-8 字节前于码点边界插入换行，规范化过程 SHALL NOT 缓存完整长行。系统 SHALL NOT 等到命令结束才发布文件，SHALL NOT 将日志全文保存在内存，也 SHALL NOT 对运行日志回卷或轮转。每个任务日志 SHALL 限制为 8 MiB（计入规范化后文本），每个活动会话同时运行的后台任务 SHALL 不超过 16 个。文件 SHALL 位于用户级 cwd 项目分区内按 session、应用实例、任务隔离的路径，目录权限 SHALL 为 0700，文件权限 SHALL 为 0600。

#### Scenario: 双流持续输出与文本解码
- **WHEN** 命令交错输出 stdout/stderr，包含跨 chunk 的中文或控制字符
- **THEN** 已采集文本 SHALL 持续可读且保持有效 UTF-8
- **AND** NUL、原文 U+FFFD 或非法字节解码产生的 U+FFFD SHALL NOT 使整个日志被 read_files 拒绝
- **AND** 不同任务与不同应用实例 SHALL NOT 覆写彼此的日志

#### Scenario: 无换行超长输出
- **WHEN** 命令连续输出跨多个 chunk 的无换行长文本，例如 minified JSON
- **THEN** 日志写入器 SHALL 插入物理换行，使各行不超过 4096 UTF-8 字节且不拆分码点
- **AND** 模型 SHALL 能通过现有 read_files 分页读取全部已保存文本
- **AND** 指引 SHALL 说明日志经过规范化，不保证字节级原始输出

#### Scenario: 日志超过容量
- **WHEN** 某任务继续输出会超过单任务 8 MiB 上限
- **THEN** 管理器 SHALL 停止任务并限制磁盘写入与内存占用
- **AND** 最终状态 SHALL 记录 output_limit 和 output_truncated 为 true
- **AND** UI SHALL 说明日志上限导致停止，不将日志声明为完整输出

#### Scenario: 活动任务数量达到上限
- **WHEN** 当前会话已有 16 个尚未收尾的后台任务且收到新后台启动请求
- **THEN** 系统 SHALL 返回明确的失败工具结果而不启动额外进程
- **AND** 原有任务 SHALL 继续运行
- **AND** 已完成任务 SHALL 不占用活动名额

#### Scenario: 文件准备或写入失败
- **WHEN** 任务文件准备失败，或运行期间日志/状态写入失败
- **THEN** 系统 SHALL 拒绝启动或停止已经启动的任务，报告可理解的运行时错误
- **AND** 系统 SHALL NOT 返回不可读取路径作为成功查询协议，或留下未托管进程继续执行
- **AND** 不能更新的旧状态文件 SHALL NOT 在 UI 中被重新确认成有效 running 状态

### Requirement: 后台进程独立于创建它的 turn

管理器 SHALL 由 app 持有并跨主会话内的 assistant turns 复用。每个任务 SHALL 固定启动时的 cwd、session ID、应用实例身份与沙箱策略，并使用独立停止控制。启动交接前的取消 SHALL 清理进程；交接后的 turn 取消 SHALL NOT 停止已注册的后台任务。

#### Scenario: 回复完成后任务继续
- **WHEN** 启动任务的 assistant turn 已完成且命令尚未退出
- **THEN** 任务 SHALL 继续运行并持续维护文件
- **AND** 下一轮模型 SHALL 能读取同一任务文件

#### Scenario: 启动期间按 Esc
- **WHEN** 用户在后台启动交接完成前取消 turn
- **THEN** 系统 SHALL 清理待交接进程与句柄
- **AND** 系统 SHALL NOT 留下没有管理器归属的运行进程

#### Scenario: 交接后按 Esc 或切换模式
- **WHEN** 已注册任务继续运行期间用户中断当前 turn，或后续切换交互模式
- **THEN** 该任务 SHALL 继续运行并保留原启动目录和沙箱边界
- **AND** 系统 SHALL NOT 因后续模式变更提升该进程权限

#### Scenario: 停止与自然退出竞争
- **WHEN** 用户停止、timeout、进程退出或 I/O 故障同时触发收尾
- **THEN** 管理器 SHALL 幂等收尾，只发布一个确定终态并只释放一次资源
- **AND** 已经结束的任务 SHALL NOT 再次被终止或产生重复完成通知

### Requirement: 会话离开与应用退出清理任务

系统 SHALL 在清空当前会话、成功切换到其他会话或成功 fork 后离开源会话时，清理离开会话的运行任务。正常应用退出 SHALL 清理全部运行任务并关闭文件。清理 SHALL 尽力终止命令进程组，先优雅终止再强制终止，等待 SHALL 有界。系统 SHALL NOT 宣称保证 SIGKILL、断电或逃离进程组后的全部后代进程清理。

#### Scenario: 清空或切换会话
- **WHEN** `/clear`、`/resume` 或 `/fork` 成功改变当前会话身份
- **THEN** 离开会话的任务 SHALL 被停止收尾，新会话 SHALL 不继承进程控制
- **AND** 旧任务迟到回调 SHALL NOT 修改新会话 transcript、footer 或通知
- **AND** 已完成任务文件 SHALL 保留为历史引用

#### Scenario: 会话切换取消或失败
- **WHEN** 用户取消切换，或新会话加载/创建失败而仍留在原会话
- **THEN** 原会话后台任务 SHALL 继续运行
- **AND** 系统 SHALL NOT 仅因尝试切换而停止任务

#### Scenario: 正常退出
- **WHEN** 用户正常退出应用，包括 Ctrl+C 或 Ctrl+D 的既有退出路径
- **THEN** 系统 SHALL 等待共享的异步清理流程，有界地停止后台任务、关闭日志并执行终端清理，再结束应用进程
- **AND** 未完成任务 SHALL NOT 被报告为自然成功退出

#### Scenario: 重复退出与自动更新交还终端
- **WHEN** 多个退出入口重复触发，或自动更新即将交还终端并启动更新子进程
- **THEN** 系统 SHALL 复用同一在途 shutdown Promise，不重复关闭资源
- **AND** /exit、输入退出和更新路径 SHALL 等待同一清理完成，不提前 process.exit 或启动更新子进程
- **AND** 后台任务集合的异步清理总期限 SHALL 不超过 2 秒，超期 SHALL 按未知结果处理并在 finally 恢复终端

#### Scenario: 恢复历史引用
- **WHEN** 恢复会话中含其他应用实例创建的任务路径，且当前实例没有对应运行句柄
- **THEN** 系统 SHALL 将其作为历史文件引用，UI SHALL 明确显示未托管、执行结果未知或已知历史终态
- **AND** 系统 SHALL NOT 根据旧 running 快照显示当前活动任务、重新启动命令或按历史 PID 接管/杀死进程
- **AND** 系统 SHALL NOT 因缺少本地句柄而改写可能仍属于另一运行实例的状态文件

### Requirement: 本地任务界面与完成通知

系统 SHALL 提供 `/tasks`，通过 CommandHost 领域端口列出当前会话的后台任务、查看有界日志尾部并停止任务。列表 SHALL 合并当前会话的管理器条目与该 session transcript 中 tool_result.details 的合法后台任务引用；按 session_id 过滤，按 (session_id, owner_instance_id, task_id) 去重，持有句柄的管理器条目优先。只有文件引用的条目 SHALL 作为只读历史展示，不允许停止。列表和详情 SHALL 在进入时取快照，并支持 r 手动刷新；SHALL NOT 接入 activity tick 或启动自动轮询。该命令 SHALL 沿用普通 slash command 的响应期排队规则，不新增模型工具或独立输入循环。任务完成 SHALL 最多产生一次有界本地通知，SHALL NOT 自动启动模型推理或向原调用追加第二个 tool result。第一版 SHALL NOT 在底栏展示后台任务数量。

#### Scenario: 查看和停止任务
- **WHEN** 用户打开 `/tasks` 并选择运行任务
- **THEN** 界面 SHALL 展示命令摘要、运行状态、耗时和日志入口，不单独展示内部任务 ID
- **AND** 用户 SHALL 能查看有界日志尾部、按 r 手动刷新、确认停止或用 Esc 取消
- **AND** 停止操作 SHALL 按任务身份查找当前实例句柄，而不是执行模型提供的任意 PID

#### Scenario: 列表与详情结构
- **WHEN** 用户打开 `/tasks`
- **THEN** 列表 SHALL 每行展示一条任务，包含状态标记、压成单行并按宽度截断的命令摘要和快照耗时，不展示内部任务 ID
- **AND** 运行中与历史未托管条目 SHALL 使用不同标记，未托管条目 SHALL NOT 显示为运行中
- **AND** 无任务时 SHALL 显示中文空态，不展示伪造条目或空表格
- **WHEN** 用户从列表选中一条任务进入详情
- **THEN** 详情 SHALL 展示命令、状态、耗时、日志路径和有界日志尾部，不另列内部任务 ID
- **AND** 终态任务 SHALL 展示退出码或停止原因，SHALL NOT 提供可重复停止的活动操作
- **AND** Esc SHALL 从详情返回列表，列表内 Esc SHALL 关闭 surface

#### Scenario: 无任务或任务已结束
- **WHEN** 当前会话无任务，或用户选择已经结束的任务
- **THEN** 界面 SHALL 显示空态或真实历史终态
- **AND** 已结束任务 SHALL 能查看保留日志，不显示可重复停止的活动状态

#### Scenario: 恢复会话时管理器为空
- **WHEN** 当前 session 的工具结果包含合法任务引用，但当前实例没有对应进程句柄
- **THEN** /tasks SHALL 从 transcript 引用展示历史条目，允许读取文件但不允许停止
- **AND** 旧 running 文件 SHALL 仅展示为未托管快照，不计入当前活动数量
- **AND** 文件缺失、格式损坏或身份不匹配 SHALL 显示不可读取，不接管进程

#### Scenario: 引用去重及完整历史来源
- **WHEN** 当前实例条目和 transcript 引用具有同一任务身份，或 session 已发生 compaction
- **THEN** /tasks SHALL 只显示一条对应任务，以当前实例句柄状态为准
- **AND** 引用来源 SHALL 覆盖 session journal 的有效记录，不仅是模型活跃上下文
- **AND** 其他拥有者 session_id 的引用，包括 fork 继承的源引用，SHALL NOT 进入当前 session 的列表

#### Scenario: 手动刷新快照
- **WHEN** 用户进入任务日志后又产生新输出，但尚未按 r
- **THEN** 日志视图 SHALL 保持已读取快照，不启动每秒刷新
- **WHEN** 用户按 r 或完成停止操作
- **THEN** 当前视图 SHALL 重新读取有界日志与状态快照

#### Scenario: 响应期间提交命令
- **WHEN** assistant 正在响应时用户提交 `/tasks`
- **THEN** 命令 SHALL 遵循现有普通命令排队行为
- **AND** 系统 SHALL NOT 抢占审批、用户问题或其他活跃 surface

#### Scenario: 空闲时后台任务完成
- **WHEN** 后台任务结束且 agent 已经空闲
- **THEN** UI SHALL 显示一次完成通知
- **AND** 系统 SHALL NOT 自动调用 provider、伪造 user message 或自动读取全部日志

#### Scenario: 输入或 surface 期间完成
- **WHEN** 用户正在编辑输入、审批或查看其他 surface 时任务结束
- **THEN** 完成通知 SHALL 不抢占输入焦点或替换 surface
- **AND** 原启动调用 SHALL 仍只有一条匹配的 tool result，日志与终态继续由文件查询

#### Scenario: assistant 回复期间任务完成
- **WHEN** 后台任务在 assistant 回复或工具执行期间结束
- **THEN** 完成通知 SHALL 排到本轮内的安全边界追加，SHALL NOT 在流式正文中途插入
- **AND** 通知 SHALL NOT 落在 tool_call 与其配对 tool_result 之间，也不得因此改动已提交记录
- **AND** 待发通知 SHALL 按会话身份归属，切换会话后旧条目 SHALL NOT 进入新会话
- **AND** 通知正文 SHALL 完整保留，SHALL NOT 因队列长度折叠或丢弃错误原因

### Requirement: 后台任务渲染投影

系统 SHALL 为携带合法后台任务引用的 bash 工具结果提供 transcript 专属紧凑投影，在 transcript 中只陈述已落盘的启动事实。该投影 SHALL 由纯投影函数依据 tool_result.details 决定，SHALL NOT 依赖管理器句柄或运行态；实时渲染与历史重放 SHALL 走同一条路径。

#### Scenario: 后台启动结果的 transcript 投影
- **WHEN** bash call/result 对携带合法后台任务引用并在 TUI 中渲染
- **THEN** 标题 SHALL 标明后台执行而不展示内部任务 ID，SHALL NOT 渲染为 complete 或 exit 0
- **AND** 正文 SHALL 只显示命令摘要与日志文件短名，SHALL NOT 渲染项目分区的完整绝对路径
- **AND** 投影 SHALL NOT 解析启动结果文本中的 stdout/stderr 分段，SHALL NOT 输出 stdout/stderr 标题行
- **AND** 完整绝对路径 SHALL 继续保留在模型可见的工具结果文本与 /tasks 详情中

#### Scenario: 历史重放降级
- **WHEN** transcript 中含后台任务引用，但当前实例没有对应句柄
- **THEN** transcript 投影 SHALL 只保留启动事实，SHALL NOT 显示运行中状态
- **AND** 引用缺失、格式不合法或结果缺少后台任务字段时 SHALL 继续按原前台 bash 结果解析和渲染
- **AND** 渲染 SHALL NOT 为此读取状态文件或探测进程

### Requirement: 后台启动保持工具和执行策略边界

系统 SHALL 在既有 registry、审批、沙箱边界内处理原始后台 command。后台启动可用性 SHALL 仅以当前运行是否注入后台任务管理器能力判定；该能力第一版 SHALL 仅由交互式主会话装配，headless、子 Agent 与 BTW/readonly run SHALL 不注入或继承。没有能力的运行 SHALL 在执行与审批前拒绝 background 为 true 的请求，SHALL NOT 通过嗅探 executionMode、conversationKind 或 toolPolicy 另建允许性判据。允许后台能力不等于绕过已有 command 权限策略。所有运行 SHALL 保持相同 Bash 参数结构，不通过新增工具名称或不同 schema 表达可用性差异。

#### Scenario: 高风险命令仍需审批
- **WHEN** 交互式主会话后台启动一个需要授权的命令
- **THEN** 系统 SHALL 按原始 command 展示既有审批
- **AND** 拒绝或取消审批 SHALL 不启动进程
- **AND** 允许后 SHALL 使用启动时解析的同一沙箱策略

#### Scenario: 不支持的运行上下文
- **WHEN** 当前运行未注入后台任务管理器能力，包括第一版 headless（含 full-access）、子 Agent 或 BTW/readonly run，且调用 background 为 true 的 Bash
- **THEN** 系统 SHALL 返回说明第一版后台执行范围的失败结果
- **AND** SHALL 不创建任务文件、启动进程或等待交互审批
- **AND** background 为 false 或省略时 SHALL 保持该上下文原有执行行为

#### Scenario: plan 主会话
- **WHEN** plan 主会话请求后台 Bash
- **THEN** 系统 SHALL 按原始 command 应用既有只读策略和沙箱
- **AND** 不符合策略的请求 SHALL 被拒绝，符合策略的任务 SHALL 固定其启动时边界

#### Scenario: 工具禁用不可绕过
- **WHEN** 当前主工具选择禁用了 run_bash_command
- **THEN** background 参数 SHALL NOT 恢复该工具或允许后台启动

#### Scenario: 状态文件不是进程控制权威
- **WHEN** 同 UID 子进程因目录写权限能够改写 status.json，或状态文件内容与当前管理器记录不一致
- **THEN** 运行时的活动计数、停止和 undo 保护 SHALL 继续以句柄及内存记录为准
- **AND** 系统 SHALL NOT 因文件被改写为 exited 而释放写入保护或操作文件中声明的 PID
- **AND** 文档 SHALL 说明日志/状态属于非可信本地文件，0700/0600 不提供同 UID 防篡改保证

### Requirement: 用户可见任务名称与内部身份分离

任务面板、停止确认、transcript 后台启动标题与完成通知 SHALL 使用命令识别任务，不单独展示内部 task ID。内部管理器、文件路径、结构化任务引用与模型工具协议 SHALL 保留既有 ID，以维持停止、去重、历史恢复和 undo 关联。

#### Scenario: 用命令识别任务
- **WHEN** 用户查看后台任务、确认停止或收到完成通知
- **THEN** 系统 SHALL 展示命令或有界单行命令摘要，不要求用户理解或输入内部 task ID
- **AND** 完成通知 SHALL 保留任务的真实终态或停止原因
- **AND** 系统 SHALL 继续按内部任务身份执行停止和历史关联
