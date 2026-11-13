## ADDED Requirements

### Requirement: Model 与 effort 命令支持直接参数
`/model` 与 `/effort` SHALL 接受可选的行内参数。无参数输入 SHALL 保持既有面板行为不变。有参数时，命令 SHALL 按面板展示的标签匹配目标值、直接应用，并 SHALL NOT 打开 select 或 scale surface。`/model` 的参数 SHALL 匹配模型名（面板 `label` 使用的值），SHALL NOT 要求用户提供 profile id。`/effort` 的参数 SHALL 匹配 `REASONING_EFFORTS` 中的值。两个命令的参数匹配 SHALL 大小写不敏感。匹配成功 SHALL 复用既有 `selectModel` / `selectEffort` 语义；匹配失败或命中多个候选时，系统 SHALL 显示包含可用候选的 info surface，SHALL NOT 静默选择其中一项，SHALL NOT 把带参数输入退回普通消息路径。配置不可读与保存失败 SHALL 分别复用各命令现有的配置错误与保存失败 surface。

#### Scenario: /model 按模型名直接切换
- **WHEN** 用户提交 `/model <模型名>`，且该模型名与当前配置中恰好一个模型 profile 的模型名匹配
- **THEN** 系统 SHALL 把该 profile 设为当前 session 的模型
- **THEN** 系统 SHALL NOT 打开模型选择 surface
- **THEN** 该 session 旧的 effort override SHALL 按既有 `selectModel` 语义被清除

#### Scenario: /model 参数大小写不敏感
- **WHEN** 用户提交的模型名与配置中的模型名仅大小写不同
- **THEN** 系统 SHALL 视为匹配

#### Scenario: /model 无法唯一匹配时展示候选
- **WHEN** 用户提交的模型名未命中任何 profile，或命中多个引用同名模型的 profile
- **THEN** 系统 SHALL 打开 info surface，列出可用模型名与对应 provider
- **THEN** 系统 SHALL 标出当前生效的候选
- **THEN** 系统 SHALL NOT 修改当前 session 的模型

#### Scenario: /model 配置不可读时不应用参数
- **WHEN** 模型配置不可读且用户提交带参数的 `/model`
- **THEN** 系统 SHALL 打开既有的配置错误 surface
- **THEN** 系统 SHALL NOT 尝试应用参数

#### Scenario: /model 保存失败时展示保存错误
- **WHEN** 参数匹配成功但保存当前 session 模型失败
- **THEN** 系统 SHALL 打开既有的保存失败 surface
- **THEN** 错误内容 SHALL NOT 包含敏感配置值

#### Scenario: /effort 按级别直接设置
- **WHEN** 用户提交 `/effort <级别>`，且该级别属于 `REASONING_EFFORTS`
- **THEN** 系统 SHALL 把该值设为当前 session 的显式 reasoning effort override
- **THEN** 系统 SHALL NOT 打开 scale surface
- **THEN** 系统 SHALL NOT 改写任何 model profile 的 `reasoning.effort`

#### Scenario: /effort 参数大小写不敏感且接受 none
- **WHEN** 用户提交 `/effort HIGH` 或 `/effort None` 这类大小写变体
- **THEN** 系统 SHALL 匹配对应的小写级别
- **THEN** `none` SHALL 按既有语义作为显式禁用思考保存

#### Scenario: /effort 非法级别时展示合法值
- **WHEN** 用户提交的级别不属于 `REASONING_EFFORTS`
- **THEN** 系统 SHALL 打开 info surface，列出全部合法级别
- **THEN** surface SHALL 显示当前模型与当前 effort
- **THEN** 系统 SHALL NOT 修改当前 session 的 effort

#### Scenario: 无参数输入保持面板行为
- **WHEN** 用户提交不带参数的 `/model` 或 `/effort`
- **THEN** 系统 SHALL 按既有行为打开选择面板或配置错误 surface

#### Scenario: 命令名前缀不匹配
- **WHEN** 用户提交 `/modelx` 或 `/effortx`
- **THEN** 系统 SHALL NOT 匹配这两个命令
