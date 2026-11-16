# worker-worktree-execution Specification

## Purpose
TBD - created by archiving change add-worker-worktree-parallelism. Update Purpose after archive.
## Requirements
### Requirement: 内置 Worker 按项目类型自动选择工作区
系统 SHALL 在允许普通任务执行的父运行中，为启用的内置 Worker 自动识别 Git 工作区，并在有效 Git 工作区使用独立受管 worktree，在明确非 Git 项目复用现有 cwd 串行执行。`run_subagent` SHALL 保留 `agent`、`task` 参数，不要求模型选择隔离方式或提供工作区路径。只有明确非 Git 的检测结论 SHALL 触发共享目录回退；检测错误、Git 不可用、损坏的仓库、bare 仓库、无有效 HEAD 或 worktree 创建失败 SHALL 返回诊断，SHALL NOT 静默回退。Explorer 与自定义 Agent SHALL 保持既有工作区语义。

#### Scenario: Git 项目自动隔离
- **WHEN** normal 父运行在有效 Git 工作区委派内置 Worker
- **THEN** 系统 SHALL 在启动子 provider 前创建并验证该 Worker 专属 worktree
- **THEN** Worker SHALL NOT 以父工作区作为默认文件和 Bash 执行目录

#### Scenario: 非 Git 项目保持原有实现
- **WHEN** 当前目录被明确识别为非 Git 项目且连续委派多个 Worker
- **THEN** Worker SHALL 复用当前 cwd 并逐个执行
- **THEN** 系统 SHALL 在运行说明和可观察状态中说明共享目录串行方式，外层成功结果 SHALL 保持既有最终回答协议
- **THEN** 系统 SHALL NOT 自动初始化 Git、复制项目或允许这些 Worker 重叠执行

#### Scenario: Git 异常不伪装成兼容回退
- **WHEN** Git 检测或创建 worktree 因命令缺失、仓库损坏、权限、无有效 HEAD 等原因失败
- **THEN** 对应调用 SHALL 返回可诊断的失败结果
- **THEN** 系统 SHALL NOT 启动共享父目录的替代 Worker

#### Scenario: plan 和停用策略先于工作区创建
- **WHEN** 父运行处于 plan 或 readonly 策略，或 Worker 已停用、调用无效、委派被工具策略拒绝
- **THEN** 系统 SHALL NOT 为该调用创建可写 worktree
- **THEN** 既有只读、plan、启停和参数拒绝语义 SHALL 保持生效

### Requirement: 并行 Worker 使用固定已提交基线且不接管父修改
同一连续隔离 Worker 段 SHALL 使用开始该段时解析的同一个完整 HEAD commit SHA，并为每个调用创建不同的 detached worktree。系统 SHALL 允许父工作区存在 staged、unstaged 和未跟踪内容，SHALL NOT 要求干净目录、自动 stash、创建提交、复制这些内容或改动父 index/branch。父 Agent SHALL 通过任务说明协调独立职责与接口依赖；运行说明 SHALL 明确 Worker 仅看到已提交基线。

#### Scenario: 脏父工作区不阻断委派
- **WHEN** 父工作区同时存在已暂存、未暂存及未跟踪修改
- **THEN** 系统 SHALL 仍允许创建 Worker worktree
- **THEN** Worker 初始文件 SHALL 来自固定 HEAD，而不是父未提交内容
- **THEN** 父文件、index、branch 和未跟踪文件 SHALL 保持原样

#### Scenario: 同段基线不随 HEAD 漂移
- **WHEN** 一个 Worker 段包含多个调用，且父 HEAD 在解析段基线后变化
- **THEN** 段内所有 worktree SHALL 仍从已冻结的同一 SHA 创建

#### Scenario: 子目录启动保持路径语义
- **WHEN** 父 cwd 是仓库根下的子目录
- **THEN** Worker 的默认 cwd SHALL 映射为其 worktree 中相同的仓库相对目录
- **THEN** 若该目录在固定基线中不存在，系统 SHALL 返回明确错误而不是改用父目录或静默切到仓库根
- **THEN** 诊断 SHALL 指导父 Agent 将必要目录纳入提交态基线或从已有仓库根 cwd 重新组织任务，SHALL NOT 自动提交或要求原参数无限重试

#### Scenario: Worker 提示词明确协作基线
- **WHEN** 系统为 worktree Worker 构造首次 provider 请求
- **THEN** system context SHALL 包含实际执行 cwd、固定 baseCommit、不含父未提交内容、独立职责、父级集成责任和实际 Git 元数据写权限限制
- **THEN** 系统 SHALL NOT 默认附加父 status、diff stat 或修改正文，必要接口约定 SHALL 由父 Agent 在 task 中提供

### Requirement: 受管工作区绑定真实工具目录与项目身份
系统 SHALL 区分父项目身份和 Worker 实际执行目录。文件工具、Bash、运行环境说明及生效沙箱默认 workspace 根 SHALL 使用 Worker 工作区；配置 revision、Agent/Skill 快照、会话 journal 和 usage 项目归属 SHALL 保持父项目身份。系统 SHALL NOT 为并行运行调用进程级 `process.chdir()`。受管文件编辑 SHALL 拒绝通过绝对越界路径、`..` 或符号链接写入父目录及其他 Worker；主 Agent 的现有路径能力 SHALL 不因此改变。Bash、MCP 与外部资源 SHALL 继续遵守现有权限与审批，不得把 worktree 描述为无条件 OS 沙箱。

#### Scenario: 原生编辑和 Bash 使用同一 Worker 目录
- **WHEN** Worker 分别用相对路径的 `apply_patch` 和 Bash 修改项目文件
- **THEN** 两者 SHALL 操作该 Worker worktree 中的文件
- **THEN** 其他 Worker 和父工作区的对应文件 SHALL 不因这些正常目录内操作变化

#### Scenario: 文件工具拒绝绕过路径根
- **WHEN** Worker 编辑目标通过绝对路径、父目录穿越或符号链接指向父工作区或另一个 Worker
- **THEN** 文件编辑 SHALL 被拒绝并返回失败结果
- **THEN** 目标文件 SHALL 保持未修改

#### Scenario: 写入前目录身份改变
- **WHEN** 文件编辑参数通过初始检查后、实际写入前，目标或其父目录被替换为指向根外的符号链接
- **THEN** 写入边界的路径/目录身份复核 SHALL 拒绝不能确认仍在 worktree 内的编辑
- **THEN** 实现与测试 SHALL NOT 把单次 realpath 校验当作消除全部 TOCTOU 风险的证明

#### Scenario: 生效沙箱不自动授权父目录
- **WHEN** Worker 的 Bash 使用生效 workspace-write 沙箱
- **THEN** 默认 workspace 写入根 SHALL 是该 Worker worktree
- **THEN** 系统 SHALL NOT 因继承父 cwd 而自动加入父目录或其他 worktree 的写授权
- **THEN** 沙箱关闭、不可用、显式额外写路径和 full-access 的实际边界 SHALL 被如实表达
- **THEN** repo 子目录作为执行 cwd 时，默认 workspace 写入根 SHALL 仍为该 Worker 的完整 worktreeRoot

#### Scenario: 临时路径不拆分项目用量
- **WHEN** 多个 Worker 在不同 worktree 中产生模型 usage 和稳定过程记录
- **THEN** usage SHALL 归入父项目且稳定过程 SHALL 关联父 session
- **THEN** 系统 SHALL NOT 因 worktree 路径不同而创建独立项目账本或子 session journal

### Requirement: Worker 成果留在受管工作区由父 Agent 自行审阅
每个已启动的 worktree Worker 结束后，其成果 SHALL 是工作区中的最终文件状态本身；系统 SHALL 以工作区文件系统作为唯一成果载体。交接 SHALL 说明工作区路径、固定基线（并指明变化应相对该基线比较，而不是 HEAD 或 index）、执行目录与未集成事实，MAY 包含 ignored 遗留数量。交接 SHALL NOT 包含文件内容或 diff，也 SHALL NOT 声称结果已验证。外层结果被截断时 SHALL 仍保留工作区定位与基线语义。Worker 最终报告 SHALL 作为模型自述与工作区事实并列；系统 SHALL NOT 把它当作工作区已被验证的证明。

#### Scenario: Bash 与暂存修改体现在工作区
- **WHEN** Worker 使用 Bash 创建文件、暂存修改、删除文件或产生相对基线的新提交
- **THEN** 这些变化 SHALL 存在于工作区文件系统中
- **THEN** 父 Agent SHALL 能通过 `git -C <workspace> diff --name-status <baseCommit>` 看到它们
- **THEN** 系统 SHALL NOT 因未暂存 diff 为空或缺少 apply_patch 事件而报告工作区无变化

#### Scenario: 二进制与新文件直接可读
- **WHEN** Worker 修改二进制文件或创建未跟踪文件
- **THEN** 工作区 SHALL 保存其最终原始字节
- **THEN** 父 Agent SHALL 能用既有读取工具按工作区绝对路径直接读取

#### Scenario: 忽略文件不被声明为成果
- **WHEN** 最终工作区存在 ignored 文件
- **THEN** 交接 SHALL 说明仍有未纳入结果的本地状态
- **THEN** 系统 SHALL NOT 把工作区当作空目录删除

#### Scenario: 父 Agent 负责真正集成
- **WHEN** worktree Worker 返回成功交接
- **THEN** 父工作区 SHALL 尚未被系统自动应用成果
- **THEN** 父 Agent SHALL 使用既有工具审阅并串行集成，保护当前父文件和用户修改并验证最终结果
- **THEN** 系统 SHALL NOT 自动 commit、merge、push 或以目录覆盖方式集成

#### Scenario: 交接不可确认时不虚报成功
- **WHEN** Worker 已结束但工作区状态无法读取
- **THEN** 交接 SHALL 明确状态不可确认且保留工作区定位
- **THEN** 系统 SHALL NOT 把模型的成功报告当成工作区已被验证的证明

#### Scenario: 源仓库消失后如实说明可恢复范围
- **WHEN** 源仓库被移动或删除，导致工作区的 Git 元数据不可用
- **THEN** 交接与文档 SHALL 如实说明存活文件仍可读、被删除文件内容无法恢复

### Requirement: 工作区现场保留与恢复先于清理
受管工作区 SHALL 有版本化持久登记，关联父项目、session（存在时）、子运行、真实工作区路径、启动基线与执行状态。系统 SHALL 只在确认工作区与基线一致、无 ignored/untracked 遗留且所有受管理命令/子进程组已结束时自动清理；非空或状态不明的工作区 SHALL 保留并可定位。恢复 SHALL 校验受管身份与路径，SHALL NOT 自动重启 Worker、全局 prune 或强制删除其他工作区。系统 SHALL 提供稳定登记位置及人工检查/移除的文档，SHALL NOT 以 session 离开或 TTL 强删。

#### Scenario: 空工作区正常回收
- **WHEN** Worker 结束且工作区确认与基线一致、无其他本地遗留或活动子进程
- **THEN** 系统 SHALL 移除该受管 worktree 并记录已清理状态

#### Scenario: 失败和取消保留现场
- **WHEN** Worker 失败或父 turn 被取消且工作区已产生修改
- **THEN** 系统 SHALL 先取消并等待已启动子任务 settled，再写入终态登记
- **THEN** 工作区 SHALL 保留，取消 SHALL NOT 被转换成普通可继续的失败 turn

#### Scenario: 崩溃恢复不重跑不误删
- **WHEN** 应用恢复时发现受管登记处于 preparing 或 running 且没有匹配终态
- **THEN** 恢复投影 SHALL 显示状态未确认并提供可校验的现存工作区位置
- **THEN** 系统 SHALL NOT 自动重启、强删脏目录、改写登记状态或处理非本系统登记的 worktree

#### Scenario: Headless 工作区不依赖 TUI
- **WHEN** `--once` 下 Worker 完成或失败且没有 app transcript callbacks
- **THEN** 工作区登记 SHALL 仍执行，并通过工具结果提供可持久定位的工作区路径
- **THEN** 工作区创建 SHALL NOT 放宽 headless 默认 deny 或改变提问立即取消的规则

### Requirement: 受管登记分区和创建者归属保持稳定
受管登记 SHALL 位于父 projectCwd 的既有项目 key 分区下的 worker-workspaces/workspace-id 受管目录，SHALL NOT 改按 repo root、worktreeCwd 或新建子项目分区；不同启动子目录 SHALL 保持既有各自分区。登记 SHALL 另存真实 repo root、归一化 gitCommonDir、私有 worktreeGitDir、工作目录关联及创建者 project/session/run，创建后与恢复/清理前 SHALL 核验实际 Git 归属；不明或不匹配时 SHALL 拒绝自动操作。无 session 的 headless SHALL 保留空 session 归属而非伪造 journal。登记 SHALL 独立于 session journal，稳定引用 SHALL 使用现有 append_records 协议，不新增 journal 操作。

#### Scenario: 子目录启动保留原项目分区
- **WHEN** 用户从仓库子目录启动并创建 worktree Worker
- **THEN** 登记和 session 引用 SHALL 归入父 projectCwd 对应的现有项目 key
- **THEN** 仓库根和 common-dir SHALL 仅作为额外归属信息，SHALL NOT 替换分区键

#### Scenario: 路径被其他仓库复用
- **WHEN** 恢复或清理时目录仍存在，但实际 git rev-parse --git-common-dir 或 worktree 私有关联与登记不同
- **THEN** 系统 SHALL 将该项标为无法确认归属并拒绝自动清理或将其当作原成果
- **THEN** 系统 SHALL NOT 仅凭旧绝对路径存在就递归删除目录

#### Scenario: fork 只继承历史引用
- **WHEN** /fork 创建新 session 并复制含工作区引用的历史记录
- **THEN** 源 worktree SHALL 仍属于创建它的 project/session/run，新 session SHALL 只取得历史审阅引用
- **THEN** 新 session SHALL NOT 把该引用识别为自己的活动 Worker 或据此自动清理源工作区

#### Scenario: resume 能定位工作区但不重启
- **WHEN** 用户 resume 含未完成 Worker 的源 session
- **THEN** 系统 SHALL 显示状态未确认和可校验的工作区定位
- **THEN** 系统 SHALL NOT 重启 Worker；fork、undo 截断或删除 session SHALL NOT 隐式删除所引用的工作区

#### Scenario: 其他实例运行状态不明
- **WHEN** 应用发现另一实例登记为 running 的工作区但不能确认其原运行已退出
- **THEN** 系统 SHALL 保留未知活动状态及目录，SHALL NOT 仅凭本实例无运行句柄就判定 interrupted 或清理

### Requirement: Worker 不继承主会话后台任务能力
第一版 worktree Worker SHALL 与现有子运行一样不注入或继承后台任务管理器；background: true SHALL 在执行与审批前拒绝，不创建后台任务文件或进程。工作区清理 SHALL 等待受管理命令和子进程组结算；对前台 shell 私自派生的后台进程，系统 SHALL NOT 声称提供跨 turn 托管或保证清理逃离进程组的后代，无法确认退出时 SHALL 保留工作区。

#### Scenario: Worktree 不使后台参数可用
- **WHEN** worktree Worker 请求 background: true 的 Bash
- **THEN** 系统 SHALL 返回原有不支持后台执行的失败结果
- **THEN** 系统 SHALL NOT 打开后台审批、启动进程或注册主 session 后台任务

#### Scenario: 活动进程不明不删除目录
- **WHEN** Worker 前台命令退出后仍有未结算的受管理进程组，或退出状态无法确认
- **THEN** 系统 SHALL 保留工作区并在登记/交接中表达清理受阻或状态不明
- **THEN** 系统 SHALL NOT 为方便清理而把这些进程变成主 session 的后台任务

### Requirement: 子工作区变更与父撤销历史分离
worktree Worker 的文件变更 SHALL NOT 写入父 turn 的 change recorder；只有父 Agent 实际集成到父工作区的受控编辑 SHALL 进入父变更历史。通过 Bash 或外部工具集成 SHALL 继续遵守既有 untracked 与有限恢复语义。非 Git 共享目录 Worker SHALL 保留原有父 recorder 行为。

#### Scenario: 未集成成果不污染父撤销目标
- **WHEN** Worker 修改自己的 worktree 但父 Agent 尚未应用成果
- **THEN** 父 `/undo` SHALL NOT 将该临时 worktree 的路径作为父文件恢复目标

#### Scenario: 父受控集成可按现有规则撤销
- **WHEN** 父 Agent 通过受控文件工具将成果应用到父工作区
- **THEN** 这些实际父文件修改 SHALL 进入父 turn change recorder
- **THEN** 通过 Bash 集成的额外副作用 SHALL NOT 被声明为完整受控可撤销

