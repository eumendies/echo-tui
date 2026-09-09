## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Linux bubblewrap 沙箱执行包装
在 linux 且沙箱配置启用时,系统 SHALL 以 bubblewrap 参数集包装 `<shell> -lc <command>` 执行 `run_bash_command` 的命令。参数 SHALL 按"先全局只读、后定向放行"的顺序组织:最小设备集 `/dev`(含 `/dev/null`,不绑定宿主全量 `/dev`)、`/proc`、`--ro-bind / /`、`--tmpfs /tmp`,再按策略追加仅 `workspace-write` 档的可写 bind(当前工作区、`~/.echo/agent-memory`、`extraWritablePaths` 逐条)以及禁网参数 `--unshare-net`(策略禁网时)。进程 TMPDIR 不在 `/tmp` 下时 SHALL 补充对应 bind,位于 `/tmp` 下时由 tmpfs 覆盖。可写路径 SHALL 按 realpath 归一化,不存在的目录 SHALL 保留原路径。沙箱包装 SHALL NOT 改变既有 bash 执行语义:timeout、Esc 中断、进程组终止、stdout/stderr 捕获、截断与 offload SHALL 保持既有行为。

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
