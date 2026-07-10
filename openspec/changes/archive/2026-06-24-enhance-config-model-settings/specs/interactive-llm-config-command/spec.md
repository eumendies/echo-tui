## ADDED Requirements

### Requirement: Provider 自定义 header 管理
`/config` SHALL 在 provider 详情中提供自定义 header 管理入口，并 SHALL 支持新增、编辑和删除用户 provider profile 的字符串 headers。header value SHALL 始终按敏感信息处理；preset 内置 headers SHALL 保持只读且不得向用户展示其值。

#### Scenario: 查看自定义 headers
- **WHEN** 用户从 provider 详情打开自定义 header 列表
- **THEN** 系统 SHALL 展示用户配置的 header name 和已配置状态
- **THEN** 系统 SHALL 使用 mask 隐藏所有 header value
- **THEN** 系统 SHALL NOT 把 preset 内置 header value 或用户 header value 写入 transcript、错误文本或普通可见行

#### Scenario: 新增自定义 header
- **WHEN** 用户激活显式“新增 header”选项并提交有效的 header name 和非空 value
- **THEN** 系统 SHALL 将该 header 加入当前 provider 草稿
- **THEN** 系统 SHALL NOT 在显式保存整个 `/config` 草稿前修改 `~/.echo/config.json`

#### Scenario: 编辑已有 header value
- **WHEN** 用户打开已有 header 并输入新 value 后确认
- **THEN** 系统 SHALL 更新草稿中的对应 header value
- **WHEN** 用户未输入新 value 而直接确认
- **THEN** 系统 SHALL 保留已有 header value

#### Scenario: 删除自定义 header
- **WHEN** 用户聚焦显式删除 header 操作并确认
- **THEN** 系统 SHALL 从当前 provider 草稿删除该用户 header
- **THEN** 系统 SHALL NOT 删除或覆盖 preset 内置 headers

#### Scenario: 拒绝无效或重复 header
- **WHEN** header name 为空、包含 CR/LF、与现有用户 header 按大小写不敏感重复，或 header value 包含 CR/LF
- **THEN** 系统 SHALL 显示不包含敏感 value 的可理解错误
- **THEN** 系统 SHALL NOT 保存无效 header

### Requirement: 模型详情和 context window 配置
`/config` SHALL 为每个模型 profile 提供独立模型详情页，用于编辑模型 API id、默认模型和可选 context window。模型列表 SHALL 展示 context window 摘要，并 SHALL 继续遵守 footer 高度预算和窗口化约束。模型详情 SHALL NOT 展示或编辑 reasoning effort 或 reasoning summary。

#### Scenario: 打开模型详情
- **WHEN** 用户在 provider 详情聚焦一个模型并按 Enter
- **THEN** 系统 SHALL 打开该模型的详情页
- **THEN** 详情页 SHALL 展示模型 API id、默认模型状态和 context window
- **THEN** 详情页 SHALL NOT 展示 effort、summary 或 reasoning 配置

#### Scenario: 配置显式 context window
- **WHEN** 用户为模型提交一个正整数 context window
- **THEN** 系统 SHALL 将该值写入模型草稿的 `contextWindow`
- **WHEN** 用户清空显式 context window 并确认
- **THEN** 系统 SHALL 从模型草稿移除 `contextWindow`
- **THEN** 后续运行时 SHALL 继续使用内置模型映射或默认窗口

#### Scenario: 拒绝无效 context window
- **WHEN** 用户提交零、负数、非整数或非数字 context window
- **THEN** 系统 SHALL 在模型详情中显示校验错误
- **THEN** 系统 SHALL NOT 把无效值写入草稿或配置文件

#### Scenario: 设置默认模型和删除模型
- **WHEN** 用户在模型详情激活显式设置默认模型操作
- **THEN** 草稿的 `selectedModelId` SHALL 指向当前模型
- **WHEN** 用户激活显式删除模型操作
- **THEN** 系统 SHALL 从草稿删除当前模型并返回 provider 详情
- **THEN** 保存前校验 SHALL 阻止没有任何有效模型的配置落盘

### Requirement: Config 分层返回和显式动作
`/config` SHALL 使用 provider 列表、provider 详情、header 列表、header 详情和 model 详情的分层导航。新增、删除、设置默认模型和保存 SHALL 提供显式可聚焦操作行；快捷键 MAY 保留，但 SHALL NOT 是完成关键动作的唯一方式。

#### Scenario: 子页面 Esc 返回上一级
- **WHEN** 用户在 provider 详情、header 列表、header 详情或 model 详情按 Esc，且当前不处于文本编辑
- **THEN** 系统 SHALL 返回对应上一级页面
- **THEN** 系统 SHALL 保留当前未保存草稿

#### Scenario: 顶层放弃未保存修改
- **WHEN** 用户在 provider 列表按 Esc 且草稿相对打开时已经变化
- **THEN** 系统 SHALL 要求用户确认是否放弃未保存修改
- **THEN** 只有用户确认放弃后系统 SHALL 关闭 `/config` 且不写配置文件

#### Scenario: 关键动作具有显式入口
- **WHEN** 用户不使用 `d`、`s` 或其他单键快捷键操作 `/config`
- **THEN** 用户 SHALL 仍能通过方向键和 Enter 新增或删除 provider、model、header，设置默认模型并保存配置

## MODIFIED Requirements

### Requirement: 配置持久化
`/config` 命令 SHALL 读取和写入 `~/.echo/config.json`。保存时 SHALL 写入 `llm.providers`、`llm.models` 和 `llm.selectedModel` 的 provider-backed preset 配置结构，并 SHALL 完整处理 provider `headers` 和模型 `contextWindow`。对于 UI 不展示的 `reasoning` 对象，系统 SHALL 在模型仍存在时隐藏保留其原始有效配置。系统 SHALL 保留 root 上与 LLM 配置面板无关的配置节点，写入 SHALL 使用临时文件加 rename 的原子写入方式。

#### Scenario: 首次保存创建配置文件
- **WHEN** `~/.echo/config.json` 不存在且用户在配置面板中保存有效 provider 和模型
- **THEN** 系统 SHALL 创建父目录和配置文件
- **THEN** 文件内容 SHALL 包含有效的 `llm.providers`、`llm.models` 和 `llm.selectedModel`

#### Scenario: 保存保留无关配置
- **WHEN** 现有配置文件包含 `tools`、render 或其他非 `llm.providers/models/selectedModel` 配置
- **THEN** `/config` 保存时 SHALL 保留这些无关配置
- **THEN** 系统 SHALL 只替换或更新配置面板负责管理的 LLM provider/model 配置

#### Scenario: 保存自定义 headers
- **WHEN** provider 草稿包含一个或多个有效用户自定义 headers
- **THEN** `/config` SHALL 将其保存到对应 provider profile 的 `headers` 对象
- **THEN** 后续 provider client SHALL 继续按既有规则合并 preset headers 和用户 headers

#### Scenario: 隐藏 reasoning 配置无损 round-trip
- **WHEN** 现有模型 profile 包含有效的 `contextWindow`、`reasoning.effort` 或 `reasoning.summary`
- **AND** 用户打开 `/config` 后保存该模型
- **THEN** 保存后的模型 profile SHALL 保留原有 reasoning 配置和值
- **THEN** 用户在 `/config` 中 SHALL NOT 看到或编辑这些 reasoning 字段
- **THEN** 显式 `reasoning.effort: "none"` SHALL NOT 被当作空值删除

#### Scenario: 删除显式 context window
- **WHEN** 用户在 UI 中把 context window 恢复为自动
- **THEN** 保存后的模型 profile SHALL 省略 `contextWindow`
- **THEN** 系统 SHALL 保留同一模型 profile 的隐藏 reasoning 配置

#### Scenario: 原子写入配置
- **WHEN** 用户确认保存有效配置
- **THEN** 系统 SHALL 先写入同目录临时文件
- **THEN** 系统 SHALL 通过 rename 替换目标配置文件

#### Scenario: 敏感字段不出现在错误文本
- **WHEN** 配置读取、校验或保存失败
- **THEN** 系统 SHALL 输出不包含 API key、header value、Bearer token、x-api-key 或其他敏感凭据的错误信息
- **THEN** 配置面板 SHALL 继续隐藏已输入 API key 和 header value 的明文
