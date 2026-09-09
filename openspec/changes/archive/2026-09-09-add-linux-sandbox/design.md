## Context

沙箱现状:macOS 上 `run_bash_command` 默认经 `sandbox-exec`(Seatbelt)包装执行;`src/sandbox/` 提供 provider-neutral 抽象——`SandboxPolicy`(`off` / `read-only` / `workspace-write`、`network`、`extraWritablePaths`)与 `SandboxProvider`(把 `(shell -lc command)` 包装为平台 spawn argv)。`resolveSandboxProvider` 目前按平台解析,非 darwin 返回 null;`/status` 的降级原因硬编码为 `sandbox-exec 不可用`。沙箱语义定位为审批流之外的防御纵深,不是完整安全边界。

约束:项目不引入第三方 npm 依赖与打包/构建复杂度;终端与执行语义(timeout、Esc 中断按进程组 kill、输出截断与 offload)不得因包装改变;策略配置层(`tools.sandbox`、`/config` 沙箱 Tab)平台无关,不应改动。

## Goals / Non-Goals

**Goals:**

- Linux 上 `run_bash_command` 默认进入沙箱:读取全盘放行,写入限定为工作区、进程 TMPDIR、`/tmp`、`~/.echo/agent-memory`、`/dev/null` 与 `extraWritablePaths`;网络由策略控制,`read-only` 档恒禁网
- "二进制存在但沙箱建立失败"的环境(Ubuntu 23.10+/24.04 AppArmor user namespace 限制、容器内 seccomp 阻断 unshare 等)能被识别并显式降级,`/status` 降级原因不静默
- 新增平台沙箱仍只需新增 provider 实现,不修改 bash 执行链路

**Non-Goals:**

- 不实现 Landlock、firejail、systemd-run 或容器方案
- 不收紧既有 macOS Seatbelt profile,不改变两平台的默认档位与配置模型
- 不做 PID namespace 隔离(`--unshare-pid`)、不限制读取路径、不做系统调用过滤(seccomp)
- 不为 bubblewrap 不可用的环境提供替代包装

## Decisions

### D1:选用 bubblewrap 作为 Linux 沙箱前端

Linux 无等价于 Seatbelt 的系统自带前端,候选方案对比:

- **bubblewrap**:Flatpak 同款用户态沙箱,基于 Linux namespaces;纯 argv 包装,与现有 `SandboxProvider` 模型完全契合;进程组 kill、timeout 语义自动作用于包装后的进程;发行版包管理器普遍可装
- Landlock:内核态 LSM(文件系统限制需 5.13+,TCP 网络限制需 6.7+),无外部二进制且粒度更细,但 Node 无法直接发起 landlock syscall,需要一个小 C helper 编译进构建,违背"不加构建复杂度"约束
- firejail:SUID 运行、历史 CVE 较多、语义重,排除
- systemd-run:依赖 systemd 与 dbus,unit 生命周期与失败模式复杂,不适合每条 bash 命令,排除
- Docker/Podman:过重,改变 cwd 与文件属主语义,排除

### D2:argv 包装设计与 macOS 语义对齐

`wrapCommand` 生成如下形状的 argv(mount 顺序敏感,先全局只读、后定向放行):

```text
bwrap --die-with-parent
  [--unshare-net]              # 策略禁网时
  --dev /dev                   # 最小设备集(含 /dev/null),不绑定宿主全量 /dev
  --proc /proc
  --ro-bind / /                # 读取全盘放行
  --tmpfs /tmp                 # 临时目录可写
  --bind <cwd> <cwd>                       # 仅 workspace-write 档
  --bind <~/.echo/agent-memory> <同路径>    # 仅 workspace-write 档
  --bind <extraWritablePaths 逐条> <同路径> # 仅 workspace-write 档
  <shell> -lc <command>
```

- 可写路径沿用 macOS 侧 realpath 归一化(symlink 指向真实路径,不存在的目录保留原路径)
- 进程 TMPDIR 不在 `/tmp` 下时补一条 bind;位于 `/tmp` 下时由 tmpfs 覆盖,不额外处理
- 不加 `--unshare-pid`:保持进程组 kill 与 timeout 语义最简单,v1 放宽策略与 macOS 一致,按实际失败案例迭代收紧
- 不加 `--unshare-user` 显式参数,由 bwrap 依赖的 user namespace 机制自然决定

### D3:可用性探测采用"二进制发现 + 试运行 + 缓存"

macOS 只检查 `/usr/bin/sandbox-exec` 存在;Linux 发行版差异大,"bwrap 存在但无法建立沙箱"常见,因此:

- 二进制发现:优先 `/usr/bin/bwrap`,再按 `PATH` 顺序扫描(与 seatbelt 的单固定路径不同,Linux 安装位置多样);发现逻辑允许测试注入
- 试运行:首次包装前执行一次 `spawnSync(bwrap, ['--ro-bind', '/', '/', '/bin/true'])`,成功结果缓存在 provider 实例内,失败不缓存成功态之外的重试
- 试运行失败(含 AppArmor `setting up uid map: Permission denied`、容器内 seccomp 拒绝等)按不可用处理,执行链路按无沙箱方式继续,`/status` 显式展示降级
- 沿用既有 `SandboxProvider.isAvailable` 同步接口语义,试运行只发生在探测时刻,不在每条命令路径上

### D4:平台解析与类型接线

- `SandboxProviderName` 联合类型增加 `'linux-bubblewrap'`
- `resolveSandboxProvider` 增加 `platform === 'linux'` 分支返回 bubblewrap provider;其他平台维持返回 null
- 解析函数的可注入选项从单一 `MacosSeatbeltProviderOptions` 扩展为按平台合并的选项结构(二进制路径、exists、realpath、homedir、tmpdir、试运行器),保持测试可注入性

### D5:`/status` 降级文案按 provider 区分

`status-command-ports.ts` 中硬编码的 `sandbox-exec 不可用` 改为依据 provider 实现给出的原因文案(macOS:`sandbox-exec 不可用`;Linux:bubblewrap 二进制缺失或试运行失败),`当前平台不支持沙箱` 分支保持不变。

### D6:测试策略与既有 seatbelt 测试对齐

- 纯函数测试覆盖:argv 生成(mount 顺序、禁网开关、read-only 档、TMPDIR 特例)、二进制发现顺序、平台解析
- 执行测试镜像 `test/sandbox/seatbelt-execution.test.js`:环境跳过条件为非 linux 或试运行探测失败;覆盖写工作区成功/写外部被拒、read-only 档、禁网、timeout 与 Esc 中断语义、headless full-access 豁免

## Risks / Trade-offs

- [个别文件系统上 `--ro-bind / /` 兼容性问题(FUSE、非常规挂载)] → 试运行探测先行失败,显式降级为无沙箱;按实际失败案例迭代 profile,与 macOS 侧做法一致
- [Ubuntu 23.10+/24.04 AppArmor 限制 unprivileged user namespaces,发行版外的 bwrap 可能被拒] → 试运行探测识别后显式降级;文档写明安装与放行方式(`/etc/apparmor.d/bwrap`)
- [bubblewrap 不隔离 PID namespace,沙箱内进程可逃逸出写入边界以外的行为(如 fork 后台进程)弱于容器] → 沙箱定位本就是防御纵深而非安全边界,与 macOS Seatbelt 定位一致;后续按需要评估收紧
- [试运行探测有一次性开销(约几十毫秒)] → 仅在 provider 创建/首次包装时发生并缓存,不在每条命令路径上重复
- [bwrap 需要宿主内核启用 user namespaces;极少数发行版默认关闭] → 同样落入试运行失败的显式降级路径

## Migration Plan

纯增量特性,无数据迁移:Linux 用户安装 `bubblewrap` 系统包后默认生效;缺失或不可用时行为与现状(无沙箱)一致但 `/status` 可见。回滚只需把 `tools.sandbox.mode` 设为 `off`,或回退 provider 平台分支。

## Open Questions

- 试运行探测的时机:provider 构造时立即执行,还是首次 `wrapCommand` 时惰性执行?(倾向惰性,避免无 bash 命令的会话付出探测成本;实现时定)
- `/status` 是否需要区分"二进制缺失"与"试运行失败"两种文案粒度?(倾向区分,便于用户排障;实现时定)
