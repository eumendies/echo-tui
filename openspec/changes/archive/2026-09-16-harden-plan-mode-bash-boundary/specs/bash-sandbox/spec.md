## MODIFIED Requirements

### Requirement: 沙箱作用范围与审批正交
沙箱包装 SHALL 仅作用于 agent 发起的 `run_bash_command` 工具执行。用户 shell 模式、lifecycle hooks、MCP server 进程与 Node 侧内置工具 SHALL NOT 被包装。对 default 工具策略且不处于 plan interaction mode 的运行,沙箱启用与否 SHALL NOT 改变风险分类、审批 surface 与会话授权语义;已获批准的命令 SHALL 在其运行的沙箱边界内执行。对声明 readonly 工具策略的运行,以及处于 plan interaction mode 的 default 工具策略运行,当生效沙箱可用且档位为 `read-only` 时,`run_bash_command` SHALL 直接进入执行链路,SHALL NOT 再经过文本只读白名单或人工审批,副作用由内核沙箱边界约束;沙箱未生效或档位不是 `read-only` 时 SHALL 回退严格只读白名单,readonly 运行保持既有 fail-closed 语义,plan 运行 SHALL 拒绝白名单外命令且 SHALL NOT 打开 approval surface。

#### Scenario: shell 模式命令不包装沙箱
- **WHEN** 用户在 `/mode shell` 或 `/mode shell-local` 下提交命令
- **THEN** 该命令 SHALL 不经过沙箱包装执行

#### Scenario: 默认运行的高风险命令仍走审批
- **WHEN** default 工具策略且不处于 plan interaction mode 的运行中沙箱生效,且 agent 请求命中高风险模式的 bash 命令
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

#### Scenario: plan 运行的 bash 由内核边界兜底
- **WHEN** plan interaction mode 的 default 工具策略运行中生效沙箱为可用 `read-only` 档
- **AND** agent 请求任意 `run_bash_command`,包括严格只读白名单之外的命令
- **THEN** 系统 SHALL NOT 打开 approval surface 或调用自动审批模型
- **AND** 命令 SHALL 在沙箱边界内直接执行

#### Scenario: plan 运行在沙箱未生效时回退白名单
- **WHEN** plan interaction mode 的 default 工具策略运行中生效沙箱不可用,或档位不是 `read-only`
- **AND** agent 请求未命中严格只读 allowlist 的 bash 命令
- **THEN** 系统 SHALL 拒绝该命令且 SHALL NOT 打开 approval surface

### Requirement: 运行级只读沙箱收紧
系统 SHALL 支持把已启用沙箱按单次运行收紧为 `read-only`。收紧来源 SHALL 包括运行显式声明,以及 plan interaction mode 的自动派生:处于 plan interaction mode 且工具策略为 default 的运行 SHALL 自动派生 `read-only` 收紧,使其 bash 边界由内核兜底。收紧 SHALL 仅对配置档位非 `off` 且未被 headless `full-access` 豁免的运行生效,生效档位 SHALL 恒为禁网的 `read-only`;配置为 `off` 时 SHALL 保持显式关闭。运行级收紧 SHALL 由该运行的委派子 Agent 继承,作为子运行 bash 包装的同一收紧;子运行的 Bash 分类与审批策略 SHALL 保持其执行策略的既有语义。运行级收紧 SHALL 与执行包装和 transient 注记使用同一份解析结果;由 plan interaction mode 派生的收紧 SHALL 同时反映在 `/status`。

#### Scenario: workspace-write 配置被收紧为 read-only
- **WHEN** 用户配置档位为 `workspace-write` 且运行声明只读收紧
- **THEN** 该次运行的生效档位 SHALL 为 `read-only` 且网络关闭
- **AND** 命令 SHALL NOT 能写当前工作区

#### Scenario: plan 运行自动收紧为 read-only
- **WHEN** interaction mode 为 plan 的运行使用 default 工具策略,且用户配置档位为 `workspace-write`
- **THEN** 该次运行的生效档位 SHALL 为 `read-only` 且网络关闭
- **AND** 命令 SHALL NOT 能写当前工作区

#### Scenario: plan 自动收紧不作用于 readonly 运行
- **WHEN** plan interaction mode 期间打开的 BTW 运行声明 readonly 工具策略
- **THEN** 该次运行 SHALL 继续只读取用户配置的沙箱档位
- **AND** SHALL NOT 因 interaction mode 为 plan 而自动收紧

#### Scenario: 子运行继承运行级收紧
- **WHEN** 运行声明只读收紧或由 plan interaction mode 自动派生收紧
- **AND** 该运行委派子 Agent
- **THEN** 子运行的 bash 包装 SHALL 使用同一 `read-only` 收紧
- **THEN** 子运行的 Bash 分类与审批策略 SHALL 保持其执行策略（general 或 readonly）的既有语义

#### Scenario: 显式 off 不被收紧启用
- **WHEN** 用户配置档位为 `off` 且运行声明只读收紧或由 plan interaction mode 自动派生
- **THEN** 该次运行 SHALL NOT 启用沙箱包装

#### Scenario: full-access 豁免优先
- **WHEN** headless `full-access` 运行声明只读收紧或由 plan interaction mode 自动派生
- **THEN** 该次运行 SHALL NOT 启用沙箱包装

### Requirement: 沙箱状态可观测与模型提示
当沙箱配置为非 `off` 档时,系统 SHALL 在内置 transient 系统上下文中追加一条沙箱边界说明(可写边界与网络状态),该说明 SHALL NOT 成为 transcript 记录。沙箱当前生效档位、网络状态与实现标识 SHALL 可通过 `/status` 观测;provider 不可用导致的降级 SHALL NOT 静默。

#### Scenario: transient 上下文包含沙箱说明
- **WHEN** 沙箱配置为 `workspace-write` 且 provider 可用
- **THEN** 内置 transient 上下文 SHALL 包含沙箱写边界与网络状态的说明
- **AND** transcript 记录 SHALL NOT 新增该说明

#### Scenario: 沙箱降级不静默
- **WHEN** 沙箱配置启用但 provider 不可用
- **THEN** `/status` SHALL 展示沙箱不可用状态

#### Scenario: plan mode 的沙箱状态反映运行级收紧
- **WHEN** interaction mode 为 plan 且用户配置档位为 `workspace-write`、provider 可用
- **THEN** transient 沙箱说明 SHALL 描述只读工作区与禁网边界
- **AND** `/status` 沙箱行 SHALL 显示 `read-only` 与网络关闭
