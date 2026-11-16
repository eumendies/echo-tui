## MODIFIED Requirements

### Requirement: 沙箱可写与网络边界
沙箱策略 SHALL 定义可写集合与网络开关。默认可写集合 SHALL 包含:realpath 后的当前工作区（worktree Worker 使用完整 worktreeRoot，而不是映射后的子目录 cwd）、realpath 后的进程 TMPDIR、平台临时目录(macOS 为 `/private/tmp`,Linux 为 `/tmp`)、`~/.echo/agent-memory`、`/dev/null`,以及 `extraWritablePaths` 中每个 realpath 后的目录。文件读取 SHALL 全盘放行。`read-only` 档 SHALL 从可写集合中移除当前工作区且 SHALL 恒定禁网。`workspace-write` 档的网络行为 SHALL 由 `network` 配置决定,关闭时 SHALL 禁止网络访问。

#### Scenario: 追加可写目录生效
- **WHEN** `extraWritablePaths` 包含一个绝对目录且命令写该目录
- **THEN** 写操作 SHALL 成功

#### Scenario: 符号链接路径归一化
- **WHEN** 可写路径经过 symlink 解析后指向真实路径,例如 macOS 的 `/tmp` 解析为 `/private/tmp`
- **THEN** 沙箱参数 SHALL 使用归一化后的真实路径
- **AND** 通过原路径访问的写操作 SHALL 仍被放行

#### Scenario: 内置 agent memory 脚本可写入
- **WHEN** 沙箱为默认 `workspace-write` 档且 agent 执行内置 agent-memory 脚本
- **THEN** 对 `~/.echo/agent-memory` 的写入 SHALL 成功

#### Scenario: read-only 档恒定禁网
- **WHEN** 沙箱为 `read-only` 档且无论 `network` 配置取值
- **THEN** 命令的网络访问 SHALL 被拒绝

#### Scenario: workspace-write 关闭网络
- **WHEN** 沙箱为 `workspace-write` 档且 `network` 为 `false`
- **THEN** 命令的网络访问 SHALL 被拒绝

#### Scenario: Worker 子目录 cwd 不缩小完整工作区根
- **WHEN** worktree Worker 从仓库子目录执行 Bash 且生效档位是 workspace-write
- **THEN** 默认 workspace 可写根 SHALL 是该 Worker 的完整 worktreeRoot
- **THEN** 父工作区、兄弟 worktree、私有 gitDir 与 common-dir SHALL NOT 因此自动加入额外可写集合

## ADDED Requirements

### Requirement: Worktree Worker 不自动扩展 Git 元数据写权限
系统 SHALL 分别识别 worktreeRoot、该 worktree 的私有 gitDir 与共享 gitCommonDir；工作区授权 SHALL NOT 被解释为自动授予私有 index/HEAD 或共享 objects/refs/config 的写权限。位于既有可写集合之外的 Git 元数据写入 SHALL 被生效沙箱拒绝，Bash 审批 SHALL NOT 隐式扩大该集合。平台临时目录、agent-memory、显式 extraWritablePaths、沙箱关闭/不可用和 full-access SHALL 保持真实既有语义，系统 SHALL NOT 在这些规则已覆盖元数据时声称绝对只读。系统 SHALL NOT 新增“仅供 Git 内部”的路径授权或任意 shell 命令绕过通道。

只读 Git 检查 SHALL 关闭可选锁写，例如使用 GIT_OPTIONAL_LOCKS=0，使默认无钩子等额外行为的 status/diff 不依赖刷新 index；Worker 正常任务 SHALL 不要求暂存或提交。参数受控的宿主工作区创建/清理 SHALL 与 Worker Bash 分开，仅针对已核验的受管身份执行。成果判定 SHALL 不依赖 git add/commit 或向共享对象库写入。

#### Scenario: 元数据在沙箱可写集合之外
- **WHEN** Worker 执行需要写私有 index 或共享 objects/refs 的命令，且相关真实路径不在既有可写集合中
- **THEN** 生效沙箱 SHALL 拒绝相应写入并通过原工具失败语义报告
- **THEN** 系统 SHALL NOT 因该命令已批准而改为无沙箱重跑或自动放行 common-dir

#### Scenario: 不修改 index 也能检查工作区
- **WHEN** Worker 在默认 Git 环境下对自己的工作区执行只读 status/diff，且 Git 元数据不具备写授权
- **THEN** 关闭可选锁后的检查 SHALL 能读取状态而不要求刷新私有 index
- **THEN** 系统 SHALL NOT 为使检查成功而扩大元数据写权限

#### Scenario: 显式授权和 full-access 不被虚报为只读
- **WHEN** 用户额外可写路径或既有临时目录规则覆盖了 Git 元数据，或运行实际未启用沙箱
- **THEN** 系统 SHALL 如实说明真实写入边界，SHALL NOT 声称所有元数据写入必定被阻止
- **THEN** 系统 SHALL 仍不自动暂存、提交、合并或推送

#### Scenario: 宿主生命周期不是任意 Git 代理
- **WHEN** 系统创建或移除受管 worktree
- **THEN** 宿主 SHALL 仅使用系统生成的参数、固定基线与经过归属验证的目标
- **THEN** 任意 Worker Bash SHALL NOT 通过这个生命周期入口执行额外 Git 命令或扩展权限
