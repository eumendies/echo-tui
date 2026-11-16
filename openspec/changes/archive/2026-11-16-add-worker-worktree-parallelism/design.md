## Context

当前 `createSubagentToolPort` 为每个委派建立独立 runtime，但 factory 闭包使用父 cwd。主 loop 仅并发连续 `parallel_read` 段，Worker 的 `general_purpose` 策略始终是独占。现有 subagent records、plural footer、审批 FIFO、失败交接可以复用；用户问题上下文仍会让后来的请求替换当前请求。

本设计采用已确认的边界：Git 项目隔离并行；非 Git 项目共享目录串行；父工作区可以有任意未提交修改；不要求 Worker 看到父 Agent 的进行中修改。实现仍基于 Node.js、Git CLI、现有 ANSI TUI，不切 alternate screen。

## Goals / Non-Goals

**Goals:**

- 自动为内置 Worker 选择受管 worktree 或现有共享 cwd，不改变 `run_subagent(agent, task)` 参数。
- 让相邻独立 Worker 在相同固定 commit 基线上并行，保留调度屏障、稳定提交顺序和父级取消。
- 把可审阅成果交给父 Agent，保护父工作区的已有修改和未集成的子成果。
- 保持身份、权限、持久化与计费归属一致，TUI 和 `--once` 使用同一业务语义。

**Non-Goals:**

- 非 Git 目录复制、脏工作区快照、自动 stash、commit、merge、push。
- 新增异步 Agent 通信、依赖 DAG、跨 turn 后台 Worker、父 Agent 与 Worker 同时继续推理。
- 第一版给自定义 general Agent 增加 worktree 或并行能力。
- 用 worktree 替代 OS 沙箱，或声称它能隔离 MCP、网络、数据库和端口。
- 新增通用环境编排、依赖缓存、worktree 管理 slash 命令或自动冲突解决工具。

## Decisions

### 1. 工作区选择属于 runtime，不属于模型参数

内置 Worker 在 normal 等允许普通任务的执行语义下探测父 cwd 是否位于 Git worktree。探测区分三态：有效 Git 工作区、明确非 Git 目录、检测错误。明确非 Git 才共享 cwd 并独占执行；Git 命令不可用、损坏的仓库标记、bare 仓库、没有有效 HEAD、权限错误等返回诊断，不伪装成非 Git。

plan 或 readonly 父运行不创建可写 worktree，沿用既有执行与拒绝规则。停用 Agent、无效参数或工具策略拒绝也必须在目录创建前生效。自定义 Agent 和 Explorer 保持原有方式。

替代方案是增加 `isolation` 参数，但当前用户要求的是自动 Git 增强和无 Git 兼容，增加模型选择只会扩大状态空间。

### 2. 每个连续 Worker 段冻结一次 HEAD，使用 detached worktree

预检采用延迟两阶段流程，而不是在整个 turn 开始时探测：现有调度器先等待前一只读段、Worker 段或独占调用完成，再用冻结目录和合法参数识别连续内置 Worker 候选调用；在这些调用的最终并发分类之前，异步解析真实 repo root、Git common directory 和完整 HEAD SHA，生成本段不可变的 git / non_git / error 快照。此前同 turn 的 shell 或编辑可能改变仓库状态，因此不得跨屏障复用旧的 Git 探测结果。

同步分类器只读已完成的快照，不发起 Git、等待 Promise 或创建目录。git 快照提供 parallel_worker 资格及固定 SHA；non_git 快照提供共享目录独占方式；error 快照让对应调用按原序经过既有工具结果拒绝路径失败，不启动子 runtime、不回退共享 cwd，也不因重试探测而重分类当前候选段。父级取消则走取消语义，不伪装成探测失败。

所有 git 段内 Worker 使用冻结的同一个 SHA 创建不同的 detached worktree。单个创建失败不改变段快照，其他调用可继续；下一段重新解析基线，不能让同一段随 HEAD 移动而漂移。此流程扩展现有调度器，不增加另一套 provider loop。

创建命令使用参数数组调用 Git，不拼接用户输入 shell；路径和身份由系统生成，工作树放在源仓库根的 `.echo/worktrees/<workspace-id>`，登记仍按父 projectCwd 分区存放在用户数据目录。创建前确认该路径被既有忽略规则覆盖，否则只向 common dir 的 `info/exclude` 追加一行，不改用户的 `.gitignore`，也不进入版本控制。创建后及恢复/清理前，通过真实路径和 `git rev-parse --git-common-dir` 归一化结果核对登记的仓库身份，同时验证该 worktree 的私有 gitDir 与工作目录关联；路径存在不等于归属正确。父 cwd 若在子目录，映射为 worktree 中同样的 repo-relative cwd；映射目录不存在时明确失败，不静默切到仓库根。诊断指导父 Agent 将必要目录纳入提交态基线，或从已有仓库根 cwd 重新组织任务；不得自动 commit 或用同样参数无意义重试。

不检查父目录是否干净，不拷贝 staged/unstaged/未跟踪内容，不改父 index 或 branch。相同 SHA 不能代表父工作目录的完整当前状态，必须在 Worker 和父级工具说明中明确这一点。

### 3. 并发类别与风险分类分开

新增表达独立工作区 Worker 的类别，例如 `parallel_worker`，不把 Worker 塞入 `readonlySubagentNames`，也不重用 `parallel_read` 暗示其只读。

主 loop 按 provider 原序执行三个类型的段：连续只读段、连续隔离 Worker 段、单个独占调用。类别切换形成屏障；第一版不混合 Explorer、主文件读取和 Worker 为同一段，避免增加跨工作区观察语义。只读段保持现有并发规则，Worker 段启动全部相邻合法调用，不新增未经测量的固定批次上限。

段资格由当前目录快照、父权限语义和工作区探测结果决定；每个 Worker 只有在实际创建并校验自己的 worktree 后才启动子 provider。一个创建失败只产生该调用的失败结果，其余独立 Worker 可继续；已识别为 Git 的段禁止临时改成共享目录执行。结果仍按原调用顺序成对提交，主 Agent 等整段 settled 后才继续，不允许边完成边自动集成。

以现有观察/诊断机制记录候选数、预检结论、实际启动/活跃数和工作区准备失败数，不记录任务正文、diff 或密钥；用户通过 plural footer 查看实时运行数量。补充三个及以上 Worker 的并发、逆序完成和取消测试，确认没有隐藏的单运行状态假设，不用该测试承诺无限资源规模。

### 4. 项目身份与执行目录分别传递

- `projectCwd`：父会话项目身份，决定配置 revision、Agent/Skill 冻结目录、usage 项目分区、会话 journal 和持久化归属。
- `workspaceRoot` / `workspaceCwd`：受管 repo 根及映射后的子运行 cwd，决定工具相对路径、Bash cwd、运行环境提示和生效沙箱的默认 workspace 写入根。
- `workspaceId` / `baseCommit`：用于成果关联和交接的稳定工作区身份及启动基线；不依赖模型生成。
- `worktreeGitDir` / `gitCommonDir`：Git 解析并经归属核验的私有运行元数据目录与共享仓库目录；不能从路径字符串猜测，也不等于额外写授权。

这几个值通过每次子运行输入传递，registry 在实际执行目录装配，不调用进程级 `process.chdir()`。父配置、AGENTS、memory 和 Skill 快照继续复用，但运行环境必须说明实际执行目录；不能因临时目录位置重新发现一套无关用户配置。绝对项目路径仅作为来源说明，不应误导工具写回父目录。

Worker system context 必须明确实际 cwd、固定 baseCommit、不含父 staged/unstaged/未跟踪内容、不接收兄弟修改、父 Agent 负责集成以及实际 Git 写权限限制。第一版不自动附加父 `git status --short`、`git diff --stat` 或修改正文；需要的接口约定由父 Agent 放入 task。

### 5. 路径隔离与权限边界诚实表达

受管 Worker 的文件编辑工具增加仅在该执行作用域生效的路径检查：允许 worktree 内的相对和绝对路径，拒绝通过 `..`、符号链接或替换父目录写向父工作区或其他 Worker。检查覆盖实际写入边界而非仅在解析参数时 realpath 一次；实现应结合目标/父路径的链接与身份复核以及可用的安全文件操作，无法确认写入仍位于根内时拒绝。测试覆盖校验后、写入前的目录换链；不能把单次 realpath 当作消除 TOCTOU 的证明，也不声称能抵御任意同 UID 进程在所有系统调用之间持续恶意竞态。该限制不改变主 Agent 的现有工具语义。

Bash 继续走现有风险、审批和沙箱装配，生效 workspace-write 的默认 workspace 根使用完整 worktreeRoot，而不是子目录 workspaceCwd；不自动加上父目录或其他 worktree。平台临时目录、agent-memory 和显式 extraWritablePaths 等既有规则不变；若这些规则本来就覆盖了其他目录，必须如实说明，不能声称有额外拒绝覆盖。

第一版明确区分以下三类路径：

| 路径 | Worker Bash 的自动写授权 |
| --- | --- |
| worktreeRoot | 按生效 workspace-write 规则允许 |
| worktreeGitDir（私有 HEAD/index/锁等） | 不自动额外授权 |
| gitCommonDir（共享 objects/refs/config 等） | 不自动额外授权 |

不使用“common dir 仅供 Git 内部写入”这种路径沙箱无法保证的条件授权，不新增识别任意 shell 中 Git 命令并绕过沙箱的特殊通道。只读 Git 检查应关闭可选锁写（如设置 `GIT_OPTIONAL_LOCKS=0`），默认环境中 status/diff 不应依赖私有 index 刷新成功。`git add` 除 index 外可能写共享对象库，因此即使只放行私有 gitDir 也不能保证可用。任务以修改工作文件本身交付，不要求 Worker stage/commit；Git 元数据不在既有可写集合时，写入应被生效沙箱拒绝，批准 Bash 本身不改变此边界。显式额外写路径、off、不可用沙箱或 headless full-access 可能允许这类操作，但系统不因此建议或自动执行暂存/提交。

创建/移除 worktree 的 Git 元数据写入属于参数受控的宿主生命周期，与任意 Worker Bash 分开；只对本系统管理的身份和命令执行，受父运行准入、取消和归属校验约束，不成为模型可调用的沙箱逃逸入口。成果判定不依赖暂存、提交或写共享对象库。MCP、外部资源的副作用仍由原有策略约束。

项目指令告知 Worker 只修改所分配工作区，不自行提交、切换共享分支、推送或集成。此提示不被当作内核权限保证。

### 6. 成果留在工作区，不自动提交或集成

Worker 结束后，成果就是 worktree 中的最终文件状态，系统 SHALL 以工作区文件系统作为唯一成果载体。唯一需要判定的量是「能否安全回收」：只有与冻结基线一致、无 ignored/untracked 遗留且受管命令与子进程组已结算时才移除工作区。

交接只提供定位与自查手段：工作区路径、固定 baseCommit、执行目录、`git diff --name-status <base>` 与 `git status --short` 建议命令、变化与 ignored 遗留数量，以及仍未集成的事实。交接排在有界结果预算的报告正文之前，保证截断只发生在报告；它不含文件内容或 diff，也不把工作区存在当作验证通过的结论。Worker 最终报告是模型自述，与工作区事实并列但不互相替代。

这一取舍的代价是明确的：源仓库被移动或删除后 worktree 退化为普通目录，存活文件仍可读，但被删除文件的内容无法恢复；worktree 也是活的，没有被冻结的「结束时刻」快照。需要长期归档时应由用户在清理前自行保存。

父 Agent 用既有读取、`apply_patch` 和经策略批准的 Bash 工具审阅、串行集成，不引入新的 merge tool。应用时核对父文件的当前状态，禁止用 checkout/reset/整目录覆盖丢掉用户修改；重叠改动由父 Agent 选择保留、重写或解决冲突。非重叠改动也需要集成后的整体验证。受控编辑自然进入父 change recorder；Bash/外部操作继续按现有 untracked 语义提示有限 `/undo`，不能虚称完全可撤销。

子 worktree 的编辑不使用父 change recorder，避免 `/undo` 指向临时目录；非 Git 回退仍使用原有父 recorder。Worker 成功仅指任务执行完成，不表示集成完成。

### 7. 成果优先保留，清理保守

受管登记文件在创建前记录计划、创建后记录真实路径与 repo 归属，终态更新执行和交接状态。状态可表达 preparing、running、completed/failed/cancelled、cleaned。登记和成果存于 `~/.echo/echo_tui/projects/<project-key>/worker-workspaces/<workspace-id>/` 的受管位置（自定义 store root 按同一相对布局），project-key 使用父 session 已采用的 projectCwd 字符串及其现有项目 key 规则，不改为 repo root 或 worktree 路径。仓库根下不同启动子目录保持各自既有项目分区，另存 real repo root/common-dir 身份用于核验。headless 无 session 时 ownerSessionId 为空，仍记录 projectCwd 和独立 run/workspace 身份，不伪造 session。

登记独立于 session journal，稳定工作区引用仍经现有 append_records 协议保存，不新增 journal 操作。session 删除、`/undo` 截断或 `/fork` 不得隐式删除成果。fork 后源工作区仍属于创建它的 project/session/run；新 session 仅继承历史引用，可读取审阅，但不能据此把源工作区当作自己的活动运行或取得自动清理权。resume 源 session 后能够定位原工作区，缺少终态时显示状态未确认；恢复只读历史引用不自动激活所有权，也不重启任务。多个应用实例不能只因读到 running 登记就判定对方崩溃；活动状态不明时保持未知并保留登记原状。

无相对基线变化、无 ignored/untracked 遗留且所有受管理命令/子进程组已确认结束的工作区可由系统自动移除；只要有成果、状态不明或进程尚未退出，就保留 worktree 并提供位置。Worker 不注入后台任务管理器，`background: true` 继续在执行/审批前拒绝，不继承主会话后台任务句柄。前台 shell 擅自 `&`/daemonize 不等于受支持后台能力；无法确认进程组已退出时保留工作区，不对逃离进程组的后代作完整清理保证。失败/取消时先传递 abort 并等待受管理子进程 settled，再写入终态登记，禁止在工具仍运行时移除目录。

恢复只对本系统登记、路径和仓库归属校验通过的条目做只读核对，不全局 prune，不重启 Worker，不按时间强删脏目录，也不改写登记的 running/preparing 状态。用户可以基于交接信息自行清理。用户可以基于交接信息自行清理；文档给出登记目录、`git worktree list --porcelain`、检查 status/基线 diff/未跟踪及 ignored 状态、保存成果后 `git worktree remove <path>` 的步骤。脏目录强制移除会丢失成果，必须显式警告；外部手动移除后核对登记并标记 missing/已清理，不凭过期绝对路径递归删除替代目录。新增交互式管理命令留到后续。

### 8. 审批复用 FIFO，用户问题补齐 FIFO

审批沿用已有队列，并保留 run 来源。问题上下文新增队列，每个请求保留父 turn、子 run 和 tool call 身份；答案只返回相应请求。完成或 Esc 取消当前问题后激活下一项，Esc 不顺带取消整批；父 turn 取消则一次结算所有活跃与排队问题，迟到请求拒绝。

headless 仍立即返回问题取消结果，不排队等待 stdin。受管 Worker 恢复时缺少终态不等于已确认中断：恢复投影显示状态未确认，纯渲染不做进程探测；旧无工作区元数据记录保持原有恢复规则。并行 Worker 使用现有 `parallelSize` 投影和子运行查看界面，工作区方式与成果位置在稳定记录/外层结果中可见；老记录不要求这些新字段。

## Risks / Trade-offs

- [从 HEAD 启动看不到父未提交修改] → 这是有意选择，由父 Agent 拆分独立任务、传递接口约定和最终验证；不追加干净目录门槛。
- [文件不重叠仍有语义依赖] → 报告实际测试及其基线，父 Agent 集成后跑整体测试，不把 Worker 单测通过当作整体通过。
- [worktree 不隔离公共 Git 元数据和外部服务] → 不自动提交/合并，不放宽审批，明确沙箱实际能力，测试路径边界而不宣称强容器隔离。
- [依赖、ignored 配置、submodule 环境缺失] → 不自动复制密钥、不默认链接可写依赖；使用既有批准后的命令准备环境，不能完成时报告 blocker。第一版对无法完整交接的 submodule 等状态明确保留并报限制。
- [保留工作区占用磁盘] → 空工作区自动回收，脏工作区提供稳定路径及手动检查/保存/清理流程；无 TTL，不以自动强删换取空间，明确持续保留的磁盘成本。
- [多个 Worker 同时消耗 CPU/模型配额] → 第一版复用连续段规模，不另造通用队列；plural footer 和现有诊断记录候选/启动/活跃/失败数量，以三个及以上 Worker 测试验证状态隔离，基于观测再决定资源上限。
- [Git 元数据写权限限制影响 stage/commit] → 正常任务不依赖这些命令；关闭可选锁支持只读检查，不自动开放 common-dir 或创建绕过通道，报告真实权限失败。
- [跨实例或 fork 误判工作区所有权] → 创建者 project/session/run 归属固定，历史引用不转移管理权；归属、存活或路径不明时不清理。

## Migration Plan

仅改变新运行的内置 Worker 工作区选择；旧 session records 无需迁移，缺少工作区字段保持既有投影，不补造隔离事实。受管登记使用带版本的文件格式，未知版本只报告不可自动处理，不执行删除。

可按工作区解析与清理判定、runtime 接入、调度、交互和恢复的顺序实现与测试，但不发布缺少工作区定位能力的并行写入路径。回滚代码不删除已有受管目录，用户仍可按保存路径手动处理。

## Open Questions

无阻塞本轮规范的产品问题。具体模块拆分与登记文件名可在实现中按现有项目存储惯例确定，必须满足路径安全与旧记录兼容契约。

## References

- Codex 官方 worktree 行为：https://developers.openai.com/codex/environments/git-worktrees 。仅参考 detached worktree 与生命周期；本设计不复制父工作区的未提交内容。
- Codex 开源 subagent 边界：https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents.rs 。CLI subagent 的上下文隔离不等于自动 worktree 隔离。
- Symphony 的 Workspace Manager / Agent Runner 分工：https://github.com/openai/symphony/blob/main/SPEC.md 。不引入它的常驻调度服务。
- OpenCode worktree 插件：https://github.com/kdcokenny/opencode-worktree 。参考生命周期，不采用自动提交清理。
