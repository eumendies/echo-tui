## MODIFIED Requirements

### Requirement: 工具调用并发分类
判断工具调用属于只读并行、独立工作区 Worker 并行还是独占；未知或无法证明具有对应并发资格的调用一律独占。`read_files`、`glob`、`grep`、`web_fetch`、`web_search`、`use_skill`、`list_mcp_resources`、`read_mcp_resource` SHALL 分类为 `parallel_read`。`run_bash_command` 的 background 为 true 时 SHALL 分类为 exclusive，仅在启动交接完成后释放该调用的调度屏障；省略或为 false 时 SHALL 按严格只读 Bash 策略判定：命中只读 allowlist 为 `parallel_read`，否则 `exclusive`。`run_subagent` SHALL 在调用参数可解析为目标 readonly executionPolicy subagent 时分类为 `parallel_read`；启用的内置 Worker 在父权限语义允许且当前候选段已完成异步预检并持有有效 Git 工作区快照时 SHALL 分类为 `parallel_worker`。参数 JSON 解析失败、agent 名称未知、非 Git 共享目录 Worker、自定义 general_purpose 或其他无隔离资格的调用 SHALL 分类为 `exclusive`。其余工具一律 `exclusive`。分类器 SHALL 同步读取注入的冻结目录和预检快照，不执行 Git、目录操作或异步等待；没有已完成快照 SHALL NOT 提前授予 parallel_worker 资格。错误快照对应调用 SHALL 进入原序失败结果路径，SHALL NOT 把 exclusive 分类解释为允许共享目录执行。并行 Worker 资格 SHALL NOT 加入 readonly 集合，也 SHALL NOT 放宽风险或审批分类。

#### Scenario: 观察工具保持并行分类
- **WHEN** 分类器收到 `grep`、`read_files`、`glob`、`web_fetch`、`web_search` 或 `use_skill` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`

#### Scenario: 资源读取参与并行分类
- **WHEN** 分类器收到 `list_mcp_resources` 或 `read_mcp_resource` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`
- **THEN** 连续的资源读取与其它只读调用 SHALL 允许在同一并行段执行

#### Scenario: 只读 Bash 与风险 Bash 分类不变
- **WHEN** 分类器收到 background 省略或为 false 的、只读 allowlist 内外的 `run_bash_command` 调用
- **THEN** 前者 SHALL 为 `parallel_read`，后者 SHALL 为 `exclusive`

#### Scenario: 只读子 Agent 委派并行分类
- **WHEN** 分类器收到 `agent` 参数指向 readonly executionPolicy subagent 的 `run_subagent` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`

#### Scenario: 未知或解析失败的委派保持独占
- **WHEN** `run_subagent` 参数不是合法 JSON object、`agent` 名称不在目录中，或目标为不具有受管工作区并发资格的 general_purpose
- **THEN** 分类结果 SHALL 为 `exclusive`

#### Scenario: 无委派目录的运行保持独占
- **WHEN** 当前运行没有注入 subagent 委派目录
- **THEN** 所有 `run_subagent` 调用 SHALL 分类为 `exclusive`

#### Scenario: 后台启动形成短期独占屏障
- **WHEN** 分类器收到 background 为 true 的 run_bash_command 调用，包括只读命令
- **THEN** 分类结果 SHALL 为 exclusive
- **AND** 启动结果返回后 scheduler SHALL 允许后续工具继续执行，不等待后台进程终止

#### Scenario: Git Worker 使用独立并发类别
- **WHEN** 已启用内置 Worker 的调用参数合法且当前段具有有效 Git 工作区资格
- **THEN** 分类 SHALL 为 `parallel_worker` 而不是 `parallel_read`
- **THEN** Worker SHALL 仍受 general-purpose 的风险、plan 和 headless 策略约束

#### Scenario: 非 Git 和自定义 general Agent 不获得并发资格
- **WHEN** Worker 只能复用非 Git 父目录，或调用目标为自定义 general Agent
- **THEN** 分类 SHALL 为 `exclusive`

#### Scenario: 分类不承担异步 Git 探测
- **WHEN** 调度器对 Worker 候选调用进行最终并发分类
- **THEN** 工作区预检 SHALL 已完成且分类器 SHALL 仅同步读取该段快照
- **THEN** 快照缺失或错误 SHALL NOT 导致先启动 Worker 再探测工作区

### Requirement: 并行结果顺序与取消一致性
同时运行的只读工具或同段独立工作区 Worker 实际完成顺序 MAY 不同于 provider 调用顺序，但 runtime SHALL 按 provider 原始顺序提交相邻的 tool call/result 对、调用 app result callback 并构建下一轮 continuation。每个结果 SHALL 保留自己的 call id 和 tool name。turn 取消时，系统 SHALL 取消全部同时运行的可中断操作、等待已启动任务结束或 settled，并 SHALL NOT 在 app transcript 中提交未完成并发调用组的孤立 tool call。

#### Scenario: 完成顺序不改变 transcript 顺序
- **WHEN** 同时运行的只读调用中，后一个调用先于前一个调用完成
- **THEN** runtime SHALL 等待这组连续只读调用全部达到可提交状态
- **THEN** transcript 和 app result callback SHALL 仍按 provider 原始调用顺序提交对应 call/result 对
- **THEN** 下一次 provider continuation SHALL 包含全部对应结果

#### Scenario: 单个工具失败不取消其他并发只读工具
- **WHEN** 一个只读工具返回 `ok: false` 或 handler 异常被 executor 归一化为失败结果
- **THEN** 同时运行的其他只读工具 SHALL 继续完成
- **THEN** 失败结果 SHALL 在其原始调用位置参与稳定顺序提交

#### Scenario: 用户中断并行只读调用
- **WHEN** 用户在多个只读调用同时执行期间中断当前 assistant turn
- **THEN** 同一 turn 的 abort signal SHALL 传递给全部已启动工具
- **THEN** runtime SHALL 隔离中断后的迟到 callback
- **THEN** app transcript SHALL NOT 包含只提交 call 而没有 result 的并行工具记录

#### Scenario: Worker 逆序完成仍稳定提交
- **WHEN** 同段后一个 Worker 先于前一个 Worker 完成
- **THEN** runtime SHALL 等待整段 settled 并按 provider 原序提交外层 call/result 对与 result callback
- **THEN** 主 provider continuation SHALL 包含每个调用自己的报告或失败交接

#### Scenario: 单个 Worker 失败不取消同段兄弟
- **WHEN** 同段某个 Worker 创建工作区、执行或状态判定失败而父 turn 未取消
- **THEN** 其他已接受的独立 Worker SHALL 继续完成
- **THEN** 失败 SHALL 在该调用的原始位置提交，且 SHALL NOT 回退为共享父目录执行

#### Scenario: 中断 Worker 段先等待退出再回收
- **WHEN** 用户中断正在执行多个 Worker 的父 turn
- **THEN** runtime SHALL 对全部已启动 Worker 传播取消并等待 settled
- **THEN** 系统 SHALL 保留有成果或状态不明的工作区，隔离迟到 callback，且不提交孤立的外层 tool call

## ADDED Requirements

### Requirement: Worker 候选段在屏障后完成异步预检
系统 SHALL 在前一执行段或独占调用完成后，用冻结 Agent 目录与合法调用参数识别当前连续 Worker 候选段，再在最终并发分类和子运行启动前异步探测 Git 并解析完整 HEAD SHA，形成不可变的 git、non_git 或 error 快照。系统 SHALL NOT 跨越可能改变仓库状态的屏障复用预检。git 快照 SHALL 提供同段共同基线与隔离资格；non_git 快照 SHALL 保持共享 cwd 串行；error 快照 SHALL 让对应调用按 provider 原序返回失败，不启动子运行或回退共享目录。单个 worktree 创建失败 SHALL NOT 改变已完成的段级快照。预检取消 SHALL 沿用父 turn 取消语义。

#### Scenario: 前一调用改变仓库后再探测
- **WHEN** 当前 Worker 候选段前有一个可能改变仓库状态的独占调用
- **THEN** 系统 SHALL 等待该调用完成后再探测候选段的项目类型和基线
- **THEN** 系统 SHALL NOT 使用 turn 开始前缓存的 Git 状态授予并发资格

#### Scenario: 段级探测失败无子运行
- **WHEN** 一个包含多个合法 Worker 候选调用的段预检得到 error
- **THEN** 每个候选调用 SHALL 在原位置获得配对失败结果
- **THEN** 系统 SHALL NOT 创建子 provider 请求、共享目录 Worker 或在同段重新探测以更改分类

#### Scenario: 个体创建失败不改段资格
- **WHEN** 候选段预检为 git 但第一个 Worker 创建 worktree 失败
- **THEN** 该调用 SHALL 返回失败，其他调用 SHALL 继续使用原快照和固定 SHA 创建自己的 worktree
- **THEN** 系统 SHALL NOT 将整段或任一成员改为共享目录运行

### Requirement: 连续隔离 Worker 段与其他类别保持屏障
系统 SHALL 按 provider 原始顺序，把相邻 `parallel_worker` 调用构成独立执行段，在固定同一基线后启动段内全部可执行 Worker，不逐个等待前一个完成，也不新建 provider-visible 分组协议。类别切换 SHALL 构成屏障，系统 SHALL 等待当前只读段或 Worker 段全部 settled 后才执行下一个类别。非 Git Worker SHALL 继续逐个独占执行。主 Agent SHALL 等待 Worker 段结束后才恢复 provider continuation 或集成成果。既有连续只读段的并发规则 SHALL 不变。

#### Scenario: 两个 Worker 真正重叠执行
- **WHEN** 同一 provider turn 返回两个连续合法 Git Worker 调用
- **THEN** 两个 Worker SHALL 在不同 worktree 和相同固定基线上启动
- **THEN** 第二个 Worker SHALL 无需等待第一个完成即可开始执行

#### Scenario: 混合调用类别不跨越屏障
- **WHEN** 调用顺序为只读调用、两个隔离 Worker、主工作区编辑、另一个只读调用
- **THEN** 只读调用 SHALL 先完成，两个 Worker SHALL 随后并行并全部 settled
- **THEN** 主工作区编辑 SHALL 再执行，最后的只读调用 SHALL 在编辑完成后开始

#### Scenario: 非 Git Worker 仍串行
- **WHEN** 同一 provider turn 返回两个共享非 Git cwd 的 Worker 调用
- **THEN** 第二个 Worker SHALL 在第一个完成后才开始

#### Scenario: 三个以上 Worker 的调度可观察
- **WHEN** 一个隔离段启动三个或以上 Worker
- **THEN** 系统 SHALL 保持独立工作区、原序结果与统一取消语义，不依赖单个活动 Worker 槽位
- **THEN** 现有诊断机制 SHALL 能记录该段候选、实际启动、活跃及准备失败数量，且不记录任务或修改正文
