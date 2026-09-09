# bash-sandbox Specification

## Purpose
TBD - created by archiving change add-macos-bash-sandbox. Update Purpose after archive.
## Requirements

### Requirement: 沙箱配置解析与默认策略
系统 SHALL 在用户配置 `tools.sandbox` 中支持 `{ mode, network, extraWritablePaths }`:`mode` 取值 `off` | `read-only` | `workspace-write`,`network` 为布尔值,`extraWritablePaths` 为非空绝对路径字符串数组。默认配置 SHALL 为 `workspace-write` 且 `network: true`。结构或取值非法的配置 SHALL 以配置错误失败,SHALL NOT 静默回退为其他沙箱档位。配置缺失或 `mode: 'off'` 时系统 SHALL 不包装 bash 执行。

#### Scenario: 默认配置启用 workspace-write
- **WHEN** 用户配置未包含 `tools.sandbox` 节点
- **THEN** 解析后的工具配置 SHALL 等价于 `mode: 'workspace-write'`、`network: true`、`extraWritablePaths: []`

#### Scenario: 非法档位导致配置错误
- **WHEN** `tools.sandbox.mode` 不是三个合法档位之一
- **THEN** 配置解析 SHALL 抛出明确的配置错误
- **AND** 系统 SHALL NOT 以任何其他档位继续运行

#### Scenario: 显式关闭沙箱
- **WHEN** `tools.sandbox.mode` 为 `off`
- **THEN** bash 工具执行 SHALL 不经过任何沙箱包装
- **AND** 执行行为 SHALL 与未引入沙箱机制前一致

### Requirement: 沙箱 provider 抽象与平台解析
系统 SHALL 通过 provider-neutral 的沙箱协议(`SandboxPolicy` 与 `SandboxProvider`)描述沙箱策略与执行包装,平台差异 SHALL 全部收敛在 provider 实现内。系统 SHALL 按运行平台解析 provider:macOS 解析为 Seatbelt 实现,Linux 解析为 bubblewrap 实现,其他平台解析为无 provider。provider 实现在其依赖的沙箱工具不可用时 SHALL 报告不可用,调用方 SHALL 按无沙箱方式执行命令。新增平台沙箱 SHALL 只需要新增 provider 实现,SHALL NOT 要求修改 bash 执行链路。

#### Scenario: macOS 解析出 Seatbelt provider
- **WHEN** 运行平台为 darwin 且 `/usr/bin/sandbox-exec` 存在
- **THEN** 平台解析 SHALL 返回 macOS Seatbelt provider
- **AND** provider SHALL 能为给定策略生成完整沙箱 spawn argv

#### Scenario: Linux 解析出 bubblewrap provider
- **WHEN** 运行平台为 linux 且 bubblewrap 二进制可发现
- **THEN** 平台解析 SHALL 返回 Linux bubblewrap provider
- **AND** provider SHALL 能为给定策略生成完整沙箱 spawn argv

#### Scenario: 非 macOS/Linux 平台不启用沙箱
- **WHEN** 运行平台既不是 darwin 也不是 linux
- **THEN** 平台解析 SHALL 返回无 provider
- **AND** bash 工具执行 SHALL 不经过沙箱包装

#### Scenario: sandbox-exec 缺失时报告不可用
- **WHEN** 运行平台为 darwin 但 `/usr/bin/sandbox-exec` 不存在
- **THEN** provider SHALL 报告不可用
- **AND** bash 工具执行 SHALL 按无沙箱方式继续
- **AND** 该不可用状态 SHALL 通过 `/status` 可见,SHALL NOT 静默

### Requirement: macOS Seatbelt 沙箱执行包装
在 darwin 且沙箱配置启用时,系统 SHALL 以 `/usr/bin/sandbox-exec -p <profile> <shell> -lc <command>` 执行 `run_bash_command` 的命令;profile SHALL 由 `deny default` 加定向 allow 规则生成,并将策略中的可写路径按 realpath 归一化后写入规则。沙箱包装 SHALL NOT 改变既有 bash 执行语义:timeout、Esc 中断、进程组终止、stdout/stderr 捕获、截断与 offload SHALL 保持既有行为。

#### Scenario: workspace-write 下写工作区成功
- **WHEN** 沙箱为 `workspace-write` 档且命令在工作区内创建或修改文件
- **THEN** 命令 SHALL 正常完成并以零退出码结束

#### Scenario: workspace-write 下写工作区外被拒绝
- **WHEN** 沙箱为 `workspace-write` 档且命令尝试写工作区与可写集之外的路径,例如 `$HOME` 下的新文件
- **THEN** 该写操作 SHALL 被沙箱拒绝
- **AND** 命令 SHALL 以非零退出码或失败信号结束
- **AND** tool result SHALL 保持既有失败语义并包含命令输出

#### Scenario: read-only 档仅允许临时目录写入
- **WHEN** 沙箱为 `read-only` 档
- **THEN** 命令 SHALL 可以写进程临时目录与 `/private/tmp`
- **AND** 命令 SHALL NOT 能写当前工作区

#### Scenario: 沙箱内命令的中断语义不变
- **WHEN** 沙箱内命令运行中用户按 Esc 或触发 timeout
- **THEN** runner SHALL 按既有语义终止整个进程组
- **AND** 命令 SHALL 结束并生成与未沙箱执行一致的 result 结构

### Requirement: 沙箱可写与网络边界
沙箱策略 SHALL 定义可写集合与网络开关。默认可写集合 SHALL 包含:realpath 后的当前工作区、realpath 后的进程 TMPDIR、平台临时目录(macOS 为 `/private/tmp`,Linux 为 `/tmp`)、`~/.echo/agent-memory`、`/dev/null`,以及 `extraWritablePaths` 中每个 realpath 后的目录。文件读取 SHALL 全盘放行。`read-only` 档 SHALL 从可写集合中移除当前工作区且 SHALL 恒定禁网。`workspace-write` 档的网络行为 SHALL 由 `network` 配置决定,关闭时 SHALL 禁止网络访问。

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

### Requirement: headless full-access 沙箱豁免
系统 SHALL 把运行执行模式穿线到工具装配层。当运行执行模式为 headless 且审批政策为 `full-access` 时,系统 SHALL 强制关闭沙箱包装;headless 且审批政策为 `deny` 时,沙箱 SHALL 按用户配置生效;interactive 运行 SHALL 按用户配置生效。

#### Scenario: full-access 单轮运行不包装沙箱
- **WHEN** 用户运行 `echo-tui --once --full-access` 且配置启用沙箱
- **THEN** 本次运行的 `run_bash_command` SHALL 不经过沙箱包装

#### Scenario: 默认 deny 单轮运行照常包装
- **WHEN** 用户运行不带 `--full-access` 的 `echo-tui --once` 且配置启用沙箱
- **THEN** 本次运行的 `run_bash_command` SHALL 经过沙箱包装

### Requirement: 沙箱作用范围与审批正交
沙箱包装 SHALL 仅作用于 agent 发起的 `run_bash_command` 工具执行。用户 shell 模式、lifecycle hooks、MCP server 进程与 Node 侧内置工具 SHALL NOT 被包装。沙箱启用与否 SHALL NOT 改变风险分类、审批 surface 与会话授权语义;已获批准的命令 SHALL 在其运行的沙箱边界内执行。

#### Scenario: shell 模式命令不包装沙箱
- **WHEN** 用户在 `/mode shell` 或 `/mode shell-local` 下提交命令
- **THEN** 该命令 SHALL 不经过沙箱包装执行

#### Scenario: 高风险命令仍走审批
- **WHEN** 沙箱生效且 agent 请求命中高风险模式的 bash 命令
- **THEN** 系统 SHALL 按既有审批流程请求用户批准
- **AND** 批准后命令 SHALL 在沙箱边界内执行

### Requirement: 沙箱状态可观测与模型提示
当沙箱配置为非 `off` 档时,系统 SHALL 在内置 transient 系统上下文中追加一条沙箱边界说明(可写边界与网络状态),该说明 SHALL NOT 成为 transcript 记录。沙箱当前生效档位、网络状态与实现标识 SHALL 可通过 `/status` 观测;provider 不可用导致的降级 SHALL NOT 静默。

#### Scenario: transient 上下文包含沙箱说明
- **WHEN** 沙箱配置为 `workspace-write` 且 provider 可用
- **THEN** 内置 transient 上下文 SHALL 包含沙箱写边界与网络状态的说明
- **AND** transcript 记录 SHALL NOT 新增该说明

#### Scenario: 沙箱降级不静默
- **WHEN** 沙箱配置启用但 provider 不可用
- **THEN** `/status` SHALL 展示沙箱不可用状态

### Requirement: Linux bubblewrap 沙箱执行包装
在 linux 且沙箱配置启用时,系统 SHALL 以 bubblewrap 参数集包装 `<shell> -lc <command>` 执行 `run_bash_command` 的命令。参数 SHALL 按"先全局只读、后定向放行"的顺序组织(bwrap 的文件系统选项按命令行顺序生效):`--ro-bind / /` SHALL 先于设备与临时文件系统挂载,依次为全局只读绑定 `--ro-bind / /`、最小设备集 `--dev /dev`(含 `/dev/null`,不绑定宿主全量 `/dev`)、`--proc /proc`、`--tmpfs /tmp`、`--tmpfs /dev/shm`,再按策略追加仅 `workspace-write` 档的可写 bind(当前工作区、`~/.echo/agent-memory`、`extraWritablePaths` 逐条)以及禁网参数 `--unshare-net`(策略禁网时)。进程 TMPDIR 不在 `/tmp` 下时 SHALL 补充对应 bind,位于 `/tmp` 下时由 tmpfs 覆盖。可写路径 SHALL 按 realpath 归一化,不存在的目录 SHALL 保留原路径。沙箱包装 SHALL NOT 改变既有 bash 执行语义:timeout、Esc 中断、进程组终止、stdout/stderr 捕获、截断与 offload SHALL 保持既有行为。

#### Scenario: /dev 与 /proc 不被全盘只读绑定覆盖
- **WHEN** 沙箱 argv 以 `--ro-bind / /` 在前、`--dev`/`--proc`/tmpfs 挂载在后的顺序组织
- **THEN** 沙箱内 `/dev` SHALL 是新的最小设备集且 `/dev/null` 可写
- **AND** `/proc` SHALL 是新挂载的 procfs

#### Scenario: workspace-write 下写工作区成功
- **WHEN** 沙箱为 `workspace-write` 档且命令在工作区内创建或修改文件
- **THEN** 命令 SHALL 正常完成并以零退出码结束

#### Scenario: workspace-write 下写工作区外被拒绝
- **WHEN** 沙箱为 `workspace-write` 档且命令尝试写可写集之外的路径,例如 `$HOME` 下的新文件
- **THEN** 该写操作 SHALL 被沙箱拒绝
- **AND** 命令 SHALL 以非零退出码或失败信号结束
- **AND** tool result SHALL 保持既有失败语义并包含命令输出

#### Scenario: read-only 档仅允许临时目录写入
- **WHEN** 沙箱为 `read-only` 档
- **THEN** 命令 SHALL 可以写进程临时目录与 `/tmp`
- **AND** 命令 SHALL NOT 能写当前工作区

#### Scenario: 禁网时命令网络访问被拒
- **WHEN** 策略要求禁网且命令尝试建立网络连接
- **THEN** provider SHALL 在包装参数中包含网络隔离参数
- **AND** 命令的网络访问 SHALL 失败

#### Scenario: 沙箱内命令的中断语义不变
- **WHEN** 沙箱内命令运行中用户按 Esc 或触发 timeout
- **THEN** runner SHALL 按既有语义终止整个进程组
- **AND** 命令 SHALL 结束并生成与未沙箱执行一致的 result 结构

### Requirement: Linux bubblewrap 可用性探测
系统 SHALL 对 Linux 沙箱进行两级可用性探测:先发现 bubblewrap 二进制(优先 `/usr/bin/bwrap`,再按 `PATH` 顺序扫描),再通过试运行探测沙箱能否在当前环境实际建立;试运行成功结果 SHALL 缓存,SHALL NOT 在每条命令路径上重复探测。二进制缺失或试运行失败(包括发行版 AppArmor user namespace 限制、容器内 seccomp 阻断等)SHALL 报告不可用,执行链路 SHALL 按无沙箱方式继续,`/status` SHALL 展示标识 Linux 实现的降级原因且 SHALL NOT 静默。

#### Scenario: 二进制存在且试运行成功
- **WHEN** bubblewrap 二进制可发现且试运行命令成功
- **THEN** provider SHALL 报告可用
- **AND** bash 命令 SHALL 经 bubblewrap 包装执行

#### Scenario: 试运行失败时显式降级
- **WHEN** bubblewrap 二进制存在但试运行失败,例如 Ubuntu 24.04 AppArmor 限制导致 user namespace 创建被拒
- **THEN** provider SHALL 报告不可用
- **AND** bash 工具执行 SHALL 按无沙箱方式继续
- **AND** `/status` SHALL 展示该降级及原因,SHALL NOT 静默

#### Scenario: 二进制缺失时显式降级
- **WHEN** 运行平台为 linux 但 bubblewrap 二进制不可发现
- **THEN** provider SHALL 报告不可用
- **AND** bash 工具执行 SHALL 按无沙箱方式继续
- **AND** `/status` SHALL 展示该降级及原因,SHALL NOT 静默

#### Scenario: 试运行结果缓存
- **WHEN** 同一 provider 实例内已有一条命令成功完成试运行探测
- **THEN** 后续命令执行 SHALL 复用该探测结果
- **AND** SHALL NOT 为每条命令重复执行试运行
