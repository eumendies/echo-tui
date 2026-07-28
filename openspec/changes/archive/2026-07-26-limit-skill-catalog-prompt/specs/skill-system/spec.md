## MODIFIED Requirements

### Requirement: skill catalog 常驻注入
系统 SHALL 在 provider system prompt 中注入短 skill catalog，使模型知道当前可用 skill 及其适用场景。catalog SHALL 只使用 skill 名称和 description 投影，不得包含完整 `SKILL.md` 正文。系统 SHALL 按当前模型 context window 和归一化配置比例限制 catalog 的估算 token 占用，并 SHALL 在一次 agent run 的全部 provider continuation 中复用同一 catalog 投影。

#### Scenario: 存在 skill 且完整 catalog 未超过预算
- **WHEN** 发起 provider 请求且 registry 中存在可用 skill
- **AND** 完整 skill catalog 的估算 token 未超过当前 context window 的配置比例预算
- **THEN** system prompt SHALL 包含全部可用 skill 的原始名称和完整 description
- **THEN** system prompt SHALL 指示模型在任务匹配时调用 `use_skill`
- **THEN** catalog 文本 SHALL 与未启用预算截断时的既有格式保持一致

#### Scenario: catalog 超过预算时公平截断长 description
- **WHEN** 完整 skill catalog 的估算 token 超过当前 context window 的配置比例预算
- **AND** 固定 header、格式和全部 skill 名称能够放入该预算
- **THEN** 系统 SHALL 保留全部可用 skill 名称
- **THEN** 系统 SHALL 使用统一动态 description 上限保持短 description 完整并截断超出上限的长 description
- **THEN** 投影后的完整 catalog 估算 token SHALL 不超过该预算

#### Scenario: 截断 description 保留首尾语义
- **WHEN** 某个 skill description 因 catalog 预算被截断
- **THEN** 投影 SHALL 保留该 description 的头部和尾部内容
- **THEN** 投影 SHALL 使用显式的 `[…description truncated…]` 标记表示中间内容被移除
- **THEN** 投影 SHALL NOT 产生被切断的 Unicode surrogate pair

#### Scenario: 固定开销超过预算时退化为 names-only
- **WHEN** skill catalog 的固定 header、格式和全部 skill 名称已经超过配置预算
- **THEN** system prompt SHALL 仍保留全部可用 skill 名称
- **THEN** system prompt SHALL 省略 skill description 并使用 names-only 投影
- **THEN** 系统 SHALL NOT 为满足预算而删除、重命名或截断 skill 名称

#### Scenario: 一次 agent run 内 catalog 投影稳定
- **WHEN** 一次 agent run 因 tool call 产生一个或多个 provider continuation
- **THEN** 所有 continuation SHALL 使用 run 初始化时创建的同一 skill catalog 投影
- **THEN** 系统 SHALL NOT 因 conversation token 增长或运行中配置变化重新截断 catalog

#### Scenario: provider 投影不修改原始 skill metadata
- **WHEN** provider-facing catalog 使用 truncated 或 names-only 投影
- **THEN** `/skills`、slash suggestion、显式 skill 调用和 `use_skill` 加载路径 SHALL 继续使用原始 skill metadata
- **THEN** 系统 SHALL NOT 将截断后的 description 写回 `SKILL.md` 或 skill 状态文件

#### Scenario: 无 skill 时不注入空 catalog
- **WHEN** 发起 provider 请求且 registry 中没有可用 skill
- **THEN** system prompt SHALL 不包含空的 skill catalog 区块

#### Scenario: catalog 不包含完整正文
- **WHEN** skill 的 `SKILL.md` 正文包含长工作流说明
- **THEN** system prompt 中的 catalog SHALL NOT 包含该长正文
- **THEN** 该正文 SHALL 只能通过 `use_skill` 工具加载
