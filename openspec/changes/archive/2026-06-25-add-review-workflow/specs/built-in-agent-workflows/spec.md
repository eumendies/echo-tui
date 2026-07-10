## ADDED Requirements

### Requirement: /review 审查当前工作区代码变更
系统 SHALL 提供纯 `/review` 内置 workflow。该 workflow SHALL 以当前 Git 工作区相对 `HEAD` 的 staged、unstaged 和 untracked 变化为审查范围，并 SHALL 读取必要的未修改代码、测试、配置和文档来理解变更影响。workflow SHALL NOT 修改代码或报告与当前变更无直接关系的存量问题。

#### Scenario: 工作区存在可审查变更
- **WHEN** 用户提交纯 `/review`
- **AND** 当前 Git 工作区包含 staged、unstaged 或 untracked 变化
- **THEN** agent SHALL 建立完整变更清单并检查对应 diff 或文件内容
- **THEN** agent SHALL 读取验证变更行为所需的相关上下文
- **THEN** agent SHALL NOT 调用 `apply_patch` 或执行修改项目文件的命令

#### Scenario: 工作区没有变更
- **WHEN** 用户提交纯 `/review`
- **AND** 当前 Git 工作区相对 `HEAD` 没有可审查变化
- **THEN** agent SHALL 明确说明没有可审查的当前代码变更
- **THEN** agent SHALL NOT 转而审查无关存量代码

#### Scenario: 当前目录不是 Git 工作区
- **WHEN** 用户提交纯 `/review`
- **AND** agent 无法确认当前目录属于 Git 工作区
- **THEN** agent SHALL 明确说明无法确定 review 基线
- **THEN** agent SHALL NOT 猜测文件范围或生成推测性 findings

### Requirement: /review 按优先级发现并验证问题
`/review` SHALL 优先检查正确性问题，再检查具有具体影响的架构问题，最后检查违反明确仓库约束或造成显著维护成本的代码风格问题。agent SHALL 在报告每个 finding 前验证其触发条件、当前变更关联性和实际影响；证据不足的候选问题 SHALL 被丢弃。

#### Scenario: 正确性问题优先检查
- **WHEN** agent 分析当前代码变更
- **THEN** agent SHALL 首先检查行为错误、回归、边界条件、错误处理、安全性、数据损坏和需求偏差
- **THEN** agent SHALL 在完成正确性检查后再检查架构和代码风格问题

#### Scenario: finding 经过针对性验证
- **WHEN** agent 准备报告一个候选问题
- **THEN** agent SHALL 定位当前变更中的具体文件和最小相关行范围
- **THEN** agent SHALL 通过代码路径、调用方、类型、配置、测试或最小可执行检查验证问题
- **THEN** agent SHALL 说明可触发条件、验证证据和实际影响

#### Scenario: 候选问题证据不足
- **WHEN** 候选问题只能表示为可能性、依赖未知假设、无法关联当前变更或仅属个人偏好
- **THEN** agent SHALL NOT 把该候选问题作为 finding 输出
- **THEN** agent SHALL 优先接受漏报而不是降低确认门槛

#### Scenario: 验证命令失败但无法归因
- **WHEN** agent 运行测试、类型检查或诊断命令且命令失败
- **AND** 失败无法被确认由当前变更引起
- **THEN** agent SHALL NOT 把该失败作为代码 finding
- **THEN** agent MAY 在验证摘要中客观说明该验证未完成

### Requirement: /review 使用严重级别并排序 findings
`/review` SHALL 使用 `P0`、`P1`、`P2`、`P3` 标记已确认 findings。每个 finding SHALL 包含简洁标题、严重级别、精确位置、触发条件、验证证据和影响。结果 SHALL 按 P0 到 P3 排列；同级 finding SHALL 优先排列正确性问题，再按影响和证据强度排列。

#### Scenario: 输出多个不同严重级别的问题
- **WHEN** agent 验证出多个 findings
- **THEN** agent SHALL 按 `P0`、`P1`、`P2`、`P3` 的顺序输出
- **THEN** 每个 finding SHALL 包含当前变更中的文件位置和最小相关行范围
- **THEN** 每个 finding SHALL 描述触发条件、验证证据和用户可观察影响

#### Scenario: 仅存在低影响风格候选项
- **WHEN** agent 只发现纯格式偏好、命名偏好或没有明确维护影响的 nit
- **THEN** agent SHALL NOT 输出 `P3` finding
- **THEN** agent SHALL NOT 为了填充严重级别而提升问题等级

#### Scenario: 没有达到门槛的问题
- **WHEN** 所有候选问题在验证后均未达到报告门槛
- **THEN** agent SHALL 明确输出未发现可确认问题
- **THEN** agent MAY 简要说明检查范围和已完成的验证
- **THEN** agent SHALL NOT 输出推测性建议替代 findings

### Requirement: /review 从 plan mode 切换到 normal
当 `/review` 在 plan interaction mode 下启动时，workflow handler SHALL 在提交 agent turn 前将当前 mode 切换为 normal，使该 turn 能执行必要的测试和项目诊断。该切换 SHALL NOT 改变 `/review` 只审查、不修改代码的行为边界。

#### Scenario: plan mode 启动 /review
- **WHEN** 当前 interaction mode 为 plan 且用户提交纯 `/review`
- **THEN** workflow handler SHALL 在提交 agent turn 前切换到 normal
- **THEN** `/review` SHALL 能使用 normal mode 下的验证工具
- **THEN** `/review` SHALL NOT 因 mode 切换而修改项目代码

### Requirement: /review 是优先于同名 skill 的内置命令
系统 SHALL 在通用 direct skill invocation fallback 之前注册 `/review` workflow handler。`/review` SHALL NOT 进入 skill discovery、skill enablement 或项目级 skill 覆盖规则。

#### Scenario: 同名 skill 不覆盖 /review
- **WHEN** 当前用户级或项目级 skill catalog 包含名为 `review` 的 skill
- **AND** 用户提交纯 `/review`
- **THEN** 系统 SHALL 启动内置 `/review` workflow
- **THEN** 系统 SHALL NOT 把该输入作为 direct skill invocation
