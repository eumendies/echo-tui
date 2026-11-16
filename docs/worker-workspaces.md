# Worker Workspaces

内置 `worker` 子 Agent 可以在受管 Git worktree 中运行，从而让同一个 turn 内的多个独立任务真正并行。本文说明它的工作方式、磁盘布局，以及成果如何交回给你。

## 什么时候使用受管工作区

模型只会调用 `run_subagent(agent, task)`，隔离方式由 runtime 决定，模型不能指定路径。

| 父运行情况 | Worker 的执行方式 |
| --- | --- |
| normal（或非 plan/readonly）且父 cwd 在有效 Git 工作区 | 每个 Worker 获得独立 detached worktree |
| 明确非 Git 目录（`git` 报 not a git repository） | 复用父 cwd，串行执行 |
| plan 模式、readonly 工具策略、Worker 被停用 | 不创建 worktree，沿用原有拒绝/只读语义 |
| Git 缺失、仓库损坏、bare 仓库、无 commit | 该调用以明确失败返回，**不回退**共享目录 |

`explorer` 与自定义 Agent 始终使用原有工作区语义。

## 基线：只看已提交内容

一个 turn 里**连续的一批 Worker 委派**（中间不夹其它工具调用）在开始时解析一次完整 HEAD SHA，这批内所有 worktree 都从这同一个 commit 创建。这意味着：

- 父工作区的 staged、unstaged 和未跟踪内容**不会**进入 Worker。你不需要先 stash 或提交。
- Worker 看不到兄弟 Worker 的改动，兄弟也看不到它的。
- 同一批内的基线不会随父 HEAD 移动而漂移。
- 如果父 cwd 是仓库子目录，Worker 的执行目录映射为 worktree 中同样的仓库相对路径；该目录在基线中不存在时是明确错误，系统不会改用仓库根。

因此，跨任务的接口约定要写进 `task`：Worker 看不到你未提交的代码，也不会自动获得你正在写的函数。

## Git 元数据不在默认写边界内

生效的 `workspace-write` 沙箱默认放行的是**完整 worktree 根**，而不是 worktree 的私有 `gitDir`（HEAD/index/锁）或共享 `gitCommonDir`（objects/refs/config）。

- 只读检查（`git status`、`git diff`）可以正常工作：Worker 的 Bash 关闭了可选锁写（`GIT_OPTIONAL_LOCKS=0`），不需要刷新私有 index。
- `git add` 除了 index 还会写共享对象库，因此第一版不保证可用。Worker 不需要暂存或提交也能完成交付。
- 显式 `extraWritablePaths`、沙箱关闭、沙箱不可用或 headless `--full-access` 会按既有规则放宽边界；这些情况下元数据写入可能成功，但系统仍然不会自动暂存、提交、合并或推送。

## 成果：留在 worktree 里

Worker 结束时，**它的成果就是 worktree 里的文件本身**。系统直接以工作区文件作为成果载体，也不会把文件内容塞回你的上下文。

你（或主 Agent）用既有工具直接读工作区：

```bash
git -C <worktree> diff --name-status <baseCommit>   # 哪些文件变了
git -C <worktree> status --short                    # 含未跟踪文件
git -C <worktree> diff --summary <baseCommit>       # 权限变化
git -C <worktree> cat-file blob <baseCommit>:<path> # 被删除文件的原内容
```

存活文件的最终内容直接 `read_files <worktree>/<path>` 就能读到；二进制也是原始字节。

### 磁盘布局

```
<repo-root>/.echo/worktrees/<workspace-id>/    # 工作树本体，成果就在这里
~/.echo/echo_tui/projects/<project-key>/worker-workspaces/<workspace-id>/
  workspace.json                               # 版本化登记：创建者、基线、Git 归属、状态、清理结果
```

工作树放在源仓库里（跟随仓库走，在项目目录里就能直接看）；登记留在用户数据目录，因为分区键是父会话的 `projectCwd`，不是仓库。

创建前会确认 `.echo/worktrees/` 已被忽略：仓库自己有 `.gitignore` 覆盖就复用，否则只往 `<common-dir>/info/exclude` 追加一行 —— 不改你的 `.gitignore`，也不进入版本控制。

`project-key` 与 session/usage 分区使用同一规则（`sha1(projectCwd)`）。同一仓库的不同启动子目录保持各自的分区，另存 repo root 与 common dir 用于归属核验。

### 交接里给什么

外层 tool result 的交接块只提供定位与基线语义：

- 工作区路径、执行子目录、固定基线
- 「未集成」事实
- 「变化要相对这个基线比较」的说明
- ignored 遗留数量

它不含文件内容或 diff，也不声称结果已验证。Worker 返回的字符串报告说明它做了什么、测了什么、有什么风险 —— 这是模型自述，与工作区事实相互独立，你应当以后者为准。

### 明确的取舍

这一取舍意味着两件事：

- **源仓库被删除或移动后**，worktree 会退化成普通目录，`git status` / `cat-file` 失效。此时存活文件仍可读，但**被删除文件的内容无法恢复**。
- worktree 是活的：Worker 结束后它仍可被修改，系统没有"结束时刻"的快照。

如果需要长期归档，请在清理前自行保存需要的文件。

## 清理：保守优先

只有同时满足以下条件才会自动移除 worktree：

1. 运行成功结束（`completed`）
2. 相对基线没有任何变化
3. 没有 ignored 文件遗留
4. 所有受管理命令与子进程组都已确认结束

失败、取消、状态不可读、进程退出状态不明、归属无法确认，一律保留现场。

移除使用 `git worktree remove`（不带 `--force`），脏目录会被 git 自己拒绝——这正是想要的保守行为。系统不做全局 `git worktree prune`，也不按时间或 TTL 强删。

## 手工检查与清理流程

所有命令都在 worktree 路径或源仓库里执行，不需要进入 `~/.echo` 之外的任何隐藏位置。

1. **列出受管 worktree**

   ```bash
   git worktree list --porcelain
   ```

2. **确认基线**（把 `<baseCommit>` 换成交接块或 `workspace.json` 里的值）

   ```bash
   git -C <worktree> log -1 --format=%H <baseCommit>
   git -C <worktree> diff --stat <baseCommit> --
   ```

3. **检查残留**

   ```bash
   git -C <worktree> status --short
   git -C <worktree> ls-files --others --exclude-standard
   git -C <worktree> ls-files --others --ignored --exclude-standard | head
   ```

4. **保存需要的成果**，然后移除

   ```bash
   git worktree remove <worktree>
   ```

   > **警告**：`git worktree remove --force` 会丢弃未提交的改动和未导出的文件。只有在确认成果已经保存或不再需要时才使用。同样的警告适用于 `rm -rf`。

5. 如果目录已经被外部删除，`workspace.json` 是唯一记录；系统不会依据过期的绝对路径去递归删除别的目录。

## 归档、fork 与 resume

- 登记独立于 session journal。删除 session、`/undo` 截断或 `/fork` 都不会隐式删除成果。
- `/fork` 之后，源 worktree 仍属于创建它的 project/session/run；新 session 只继承历史引用，不能据此自动清理源成果。
- `/resume` 恢复的记录会照常显示基线与工作区路径。恢复只读引用，不会重启 Worker。
- 带工作区元数据但缺少终态的运行显示为 **state unconfirmed**（原运行可能仍在其他实例中活动），而不是已确认中断；旧的无工作区记录保持原有 `interrupted before completion` 文案。

## 依赖与限制

- 需要 Git 2.x 与可用的 `git` 可执行文件；worktree 创建失败会作为该调用的失败结果返回。
- 依赖、ignored 配置、submodule 与构建产物不会自动复制。需要时用常规命令在 worktree 内准备。
- worktree 隔离的是**工作目录**，不是操作系统沙箱、网络、MCP 服务、数据库或端口。它不能替代审批与沙箱策略。
- Worker 不继承主会话的后台任务能力；`background: true` 仍在执行与审批前被拒绝。
- 保留的成果会持续占用磁盘，没有自动 TTL。
