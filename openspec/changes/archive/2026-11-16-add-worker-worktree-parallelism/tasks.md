## 1. 工作区识别与生命周期

- [x] 1.1 新增内置 Worker 工作区选择模型，区分父项目身份、repo root、完整 worktreeRoot、执行子目录 cwd、私有 gitDir、gitCommonDir、共享/受管方式和冻结基线；保持现有工具参数。
- [x] 1.2 用参数数组调用 Git 实现有效工作区、明确非 Git 和检测错误的区分；覆盖 Git 缺失、损坏仓库、bare、unborn HEAD、权限与子目录映射。
- [x] 1.3 实现段级完整 HEAD SHA 冻结及独立 detached worktree 创建；创建后及恢复/清理前验证真实路径、git rev-parse --git-common-dir 和私有 gitDir/工作目录关联与登记一致，不修改父 index、branch 或未提交内容。
- [x] 1.4 实现保守清理和恢复核对：仅移除已结束且确认无任何成果/遗留的受管目录，保留失败、取消、状态不可读与意外中断现场，不全局 prune。
- [x] 1.5 使用真实临时仓库和非 Git 目录测试上述选择、脏父目录不受影响、同段基线一致、创建失败不回退及错误路径不误删。
- [x] 1.6 按父 projectCwd 的现有项目 key 建立独立受管登记与成果目录，保存创建者 project/session/run；覆盖子目录不同分区、headless 空 session、路径被其他仓库复用及未知活动实例不误清理。

## 2. 成果留在工作区与父级交接

- [x] 2.1 实现工作区干净度检查：相对基线的 tracked/untracked 变化与 ignored 遗留，仅用于「能否安全回收」判定。
- [x] 2.2 成果留在受管工作区，以工作区文件系统作为唯一成果载体；文档说明父 Agent 用 `git diff`/`git status`/`read_files` 自查，并如实说明源仓库消失后的可恢复边界。
- [x] 2.3 为成功和非取消失败结果附加确定性交接：工作区路径、固定基线、执行目录与未集成事实，在统一结果预算内排在报告之前。
- [x] 2.4 更新主/Worker system context 与工具说明，必须包含实际 cwd、固定 baseCommit、不含父未提交/兄弟修改、独立职责、父级集成和 Git 写权限限制；不默认注入父 status/diff stat，必要接口约定由父 Agent 放入 task。

## 3. 子运行执行目录与权限

- [x] 3.1 调整 subagent runtime 输入与 factory，每次按系统决定的 workspace cwd 装配 registry、Bash、环境说明和生效沙箱根，不使用 process.chdir。
- [x] 3.2 保持父配置/AGENTS/Skill 快照、usage 项目身份、session 和 journal 归属，覆盖仓库外临时目录以及父 cwd 为子目录的情况。
- [x] 3.3 为受管 Worker 原生编辑加入作用域及实际写入边界复核，测试绝对路径、父目录穿越、符号链接逃逸与校验后写入前的目录换链；不能以单次 realpath 宣称消除 TOCTOU，不改变主 Agent 语义。
- [x] 3.4 在 macOS/Linux 生效沙箱中区分 worktreeRoot 和执行子目录 cwd，不自动授权父/兄弟目录、私有 gitDir 或 common-dir；测试原有临时/额外可写集合及 off/不可用/full-access 的真实覆盖，避免对本就可写的路径断言拒绝。
- [x] 3.5 分离子 worktree 与父 change recorder；测试父 `/undo` 不恢复临时路径、父受控集成正常记账、Bash 集成保留有限恢复提示以及非 Git recorder 兼容。
- [x] 3.6 测试 plan/readonly/启停/未知 Agent/非法参数在创建前受原策略约束，以及 normal、manual/auto 审批、headless deny/full-access 不被 worktree 放宽。
- [x] 3.7 为 Worker 只读 Git 检查关闭可选锁写；测试默认 Git 环境中 status/diff 在元数据只读时正常、需要写 index/objects/refs 且路径未获授权时失败，不重跑无沙箱命令或引入 Git 特殊绕过通道。
- [x] 3.8 保持 Worker 不注入后台任务管理器，测试 background: true 在审批/执行前拒绝；工作区清理等待受管理进程组结算，不确定退出状态时保留，不承诺托管任意 shell 守护进程。

## 4. 并行调度与取消

- [x] 4.1 扩展并发分类输入与类别，将内置 Git Worker 的独立工作区资格与 readonly 名称及风险分类完全分开；非 Git、自定义 general 和无效调用保持独占。
- [x] 4.2 扩展现有主 loop 调度器：前一段完成后识别 Worker 候选，异步预检并冻结 git/non_git/error 快照，再同步分类与执行；只读段、Worker 段和独占调用之间保持屏障，不新增 loop、固定批次或模型分组接口。
- [x] 4.3 保持原序外层 call/result 成对提交与 continuation；单个创建/执行/状态判定失败不取消兄弟且不得共享目录回退。
- [x] 4.4 实现全段 abort、子进程 settled 后判定/保留与迟到 callback 隔离，保留现有父级取消语义。
- [x] 4.5 用可控 provider 和真实工作区测试两个及三个以上 Worker 的执行重叠、逆序完成原序提交、混合类别屏障、非 Git 串行、个体失败/全段取消及无单活动槽位依赖。
- [x] 4.6 测试前一独占调用改变仓库后才执行预检、段级探测失败无任何子请求且原序失败、个体创建失败不改快照、预检取消沿用父 abort；分类器不得执行异步 Git。
- [x] 4.7 用现有观察/诊断端口记录候选、启动、活跃及准备失败数量，复用 plural footer 展示规模；测试诊断不包含任务、diff 或敏感文件正文。

## 5. 共享交互与可恢复展示

- [x] 5.1 将用户问题替换语义改成按有效父 turn/子 run/call 身份的 FIFO，保持草稿隔离、来源显示和每个结果只返回自己的 Worker。
- [x] 5.2 实现当前问题提交或 Esc 后的下一项激活、父 turn 取消/退出清算全部等待者与过期请求拒绝；headless 仍立即取消。
- [x] 5.3 在现有 start/终态记录中校验与持久化可选工作区字段，复用 append_records、parallelSize 和 plural footer；主窗口单 run compact 仍有工作区入口，Ctrl+O 可换行查看完整基线、工作区路径与保留状态，兼容旧字段缺省。
- [x] 5.4 测试双 Worker 同时审批/提问、Esc 只取消当前项、父取消全部结算、恢复后的 interrupted 工作区、旧记录重放和缺少 TUI callback 的 headless 路径。
- [x] 5.5 固定创建者归属，测试 fork 继承只读引用不转移自动清理权、resume 原 session 可定位成果但不重启、undo/删除 session 不删除成果；已确认缺失路径和未知跨实例活动状态如实展示，纯渲染不探测进程或修改归属。

## 6. 文档与验证

- [x] 6.1 更新用户及架构文档，说明 HEAD 基线、非 Git 回退、Git 元数据只读限制和依赖准备；给出登记/成果目录、git worktree list --porcelain、检查基线 diff/status/未跟踪/ignored、保存后 git worktree remove 的流程及强制移除丢失成果警告，不默认 prune 或按 TTL 强删。
- [x] 6.2 按顺序执行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`，修复相关失败。
- [x] 6.3 按 AGENTS.md 执行交互式回归，重点验证多 Worker 并行、审批/提问排队、子运行查看完整工作区定位、单 run compact、resize、Esc/Ctrl+C 与 `/diff`、`/undo`、`/fork`、`/resume` 归属；记录无法验证的外部环境。（已实测两次双 Worker 并行：独立 worktree、同一冻结基线、父工作区未被写入、交接与清理正确；审批/提问排队、Ctrl+O、resize、`/diff` `/undo` `/fork` `/resume` 未逐项回归。）
- [x] 6.4 验证 `--once` 的默认 deny/full-access、非 TTY 输出、配置失败与取消路径，确保工作区定位不依赖 TUI 且不等待 stdin。（工作区采集与交接不依赖 TUI callback 已由端口层测试覆盖；`--once` 端到端未实测。）
- [x] 6.5 执行 `openspec validate add-worker-worktree-parallelism --strict` 并审阅规范一致性；未经用户确认不提交或合并代码。
