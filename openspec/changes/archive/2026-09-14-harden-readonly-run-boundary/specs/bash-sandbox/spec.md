## MODIFIED Requirements

### Requirement: 沙箱作用范围与审批正交
沙箱包装 SHALL 仅作用于 agent 发起的 `run_bash_command` 工具执行。用户 shell 模式、lifecycle hooks、MCP server 进程与 Node 侧内置工具 SHALL NOT 被包装。对未声明 readonly 工具策略的运行,沙箱启用与否 SHALL NOT 改变风险分类、审批 surface 与会话授权语义;已获批准的命令 SHALL 在其运行的沙箱边界内执行。对声明 readonly 工具策略的运行,当生效沙箱可用且档位为 `read-only` 时,`run_bash_command` SHALL 直接进入执行链路,SHALL NOT 再经过文本只读白名单或人工审批,副作用由内核沙箱边界约束;沙箱未生效或档位不是 `read-only` 时 SHALL 回退严格只读白名单,审批语义保持既有行为。

#### Scenario: shell 模式命令不包装沙箱
- **WHEN** 用户在 `/mode shell` 或 `/mode shell-local` 下提交命令
- **THEN** 该命令 SHALL 不经过沙箱包装执行

#### Scenario: 默认运行的高风险命令仍走审批
- **WHEN** 未声明 readonly 工具策略的运行中沙箱生效,且 agent 请求命中高风险模式的 bash 命令
- **THEN** 系统 SHALL 按既有审批流程请求用户批准
- **AND** 批准后命令 SHALL 在沙箱边界内执行

#### Scenario: 只读运行的 bash 由内核边界兜底
- **WHEN** 运行声明 readonly 工具策略且生效沙箱为可用 `read-only` 档
- **AND** agent 请求任意 `run_bash_command`,包括普通分类会要求审批的命令
- **THEN** 系统 SHALL NOT 打开 approval surface 或调用自动审批模型
- **AND** 命令 SHALL 在沙箱边界内直接执行

#### Scenario: 只读运行在沙箱未生效时回退白名单
- **WHEN** 运行声明 readonly 工具策略但生效沙箱不可用,或档位不是 `read-only`
- **AND** agent 请求未命中严格只读 allowlist 的 bash 命令
- **THEN** 系统 SHALL 拒绝该命令且 SHALL NOT 打开 approval surface

## ADDED Requirements

### Requirement: macOS Seatbelt 可用性探测
系统 SHALL 对 macOS 沙箱进行两级可用性探测:先检查 `/usr/bin/sandbox-exec` 是否存在,再以最小 profile 试运行探测当前环境能否实际应用 seatbelt(嵌套在另一个 seatbelt 沙箱内时内核会拒绝应用);试运行成功结果 SHALL 缓存在 provider 实例内,SHALL NOT 在每条命令路径上重复探测。二进制缺失或试运行失败 SHALL 报告不可用,执行链路 SHALL 按无沙箱方式继续,`/status` SHALL 区分展示"二进制缺失"与"试运行失败"两类降级原因且 SHALL NOT 静默。

#### Scenario: 二进制存在且试运行成功
- **WHEN** `/usr/bin/sandbox-exec` 存在且最小 profile 试运行成功
- **THEN** provider SHALL 报告可用
- **AND** bash 命令 SHALL 经 Seatbelt profile 包装执行

#### Scenario: 试运行失败时按无沙箱降级
- **WHEN** `/usr/bin/sandbox-exec` 存在但试运行失败,例如进程嵌套在另一个 seatbelt 沙箱内
- **THEN** provider SHALL 报告不可用且 `wrapCommand` SHALL 返回 null
- **AND** bash 工具执行 SHALL 按无沙箱方式继续,SHALL NOT 因 `sandbox_apply` 被拒而逐条失败
- **AND** `/status` SHALL 展示试运行失败的降级原因,SHALL NOT 展示为可用

#### Scenario: 试运行结果缓存
- **WHEN** 同一 provider 实例内已完成一次试运行探测
- **THEN** 后续可用性判定与命令包装 SHALL 复用该探测结果
- **AND** SHALL NOT 为每条命令重复执行试运行

### Requirement: 运行级只读沙箱收紧
系统 SHALL 支持把已启用沙箱按单次运行收紧为 `read-only`。收紧 SHALL 仅对配置档位非 `off` 且未被 headless `full-access` 豁免的运行生效,生效档位 SHALL 恒为禁网的 `read-only`;配置为 `off` 时 SHALL 保持显式关闭。收紧后的档位与网络状态 SHALL 与执行包装、transient 注记和 `/status` 使用同一份解析结果。

#### Scenario: workspace-write 配置被收紧为 read-only
- **WHEN** 用户配置档位为 `workspace-write` 且运行声明只读收紧
- **THEN** 该次运行的生效档位 SHALL 为 `read-only` 且网络关闭
- **AND** 命令 SHALL NOT 能写当前工作区

#### Scenario: 显式 off 不被收紧启用
- **WHEN** 用户配置档位为 `off` 且运行声明只读收紧
- **THEN** 该次运行 SHALL NOT 启用沙箱包装

#### Scenario: full-access 豁免优先
- **WHEN** headless `full-access` 运行声明只读收紧
- **THEN** 该次运行 SHALL NOT 启用沙箱包装
