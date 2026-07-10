# interactive-llm-config-command Specification

## Purpose
定义主 UI 内 `/config` slash command 的交互式 provider/model 配置面板、provider preset catalog、配置保存/取消行为和终端清理约束。
## Requirements
### Requirement: 主 UI `/config` 配置命令
系统 SHALL 提供 `/config` slash command，用于在主 UI 内打开 provider 和模型配置面板。该命令 SHALL 使用 command runtime 和 footer command surface；打开、编辑、保存或取消配置时 SHALL NOT 写入 transcript、启动 agent loop、进入 tool approval flow 或发起模型请求。

#### Scenario: 打开配置面板
- **WHEN** 用户在主 UI composer 中输入 `/config` 并提交
- **THEN** 系统 SHALL 打开交互式 provider/model 配置面板
- **THEN** 系统 SHALL 清空 composer 并打开 active command session
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

#### Scenario: 带参数的 config 文本不是命令
- **WHEN** 用户提交 `/config more` 或其他带额外文本的 config 前缀
- **THEN** slash command SHALL NOT 命中配置面板
- **THEN** 系统 SHALL 按普通用户消息处理该文本

#### Scenario: 取消配置
- **WHEN** 配置面板处于活跃状态且用户按下 Esc 退出未保存流程
- **THEN** 系统 SHALL 关闭 command session 并恢复普通 composer footer
- **THEN** 系统 SHALL NOT 修改 `~/.echo/config.json`

### Requirement: Provider preset catalog
系统 SHALL 提供 provider preset catalog，将用户可见 provider 类型映射为后台运行时协议配置。配置面板 SHALL 让用户选择 provider preset，不得要求或展示 `agentType` 字段。catalog SHALL 至少包含 OpenAI Responses API、OpenAI Chat Compatible API、Anthropic Compatible API 和 Xiaomi Mimo Token Plan preset；后续预定义 provider SHALL 能通过新增 preset 元数据复用已有 agent adapter。

#### Scenario: 首版 provider 类型
- **WHEN** 用户新增 provider 并打开 provider 类型选择
- **THEN** 配置面板 SHALL 提供 OpenAI Responses API、OpenAI Chat Compatible API、Anthropic Compatible API 和 Xiaomi Mimo Token Plan 选项
- **THEN** 每个选项 SHALL 显示用户可理解的名称和说明，而不是显示 `agentType`

#### Scenario: 后台解析 agent type
- **WHEN** 用户保存使用某个 preset 的 provider
- **THEN** 系统 SHALL 根据 preset catalog 决定运行时 `agentType`
- **THEN** 用户输入或配置面板 SHALL NOT 直接提供 `agentType`

#### Scenario: 预定义 provider 使用固定协议参数
- **WHEN** catalog 中存在 Xiaomi Mimo Token Plan 这类预定义 provider preset，且该 preset 定义固定 `baseURL`、headers 或 `agentType: "openai-chat"`
- **THEN** 配置面板 SHALL 只要求用户填写该 preset 需要的用户字段，例如 API key 和模型
- **THEN** 保存和运行时解析 SHALL 使用 catalog 中的固定协议参数

#### Scenario: Base URL 根据 preset 控制展示
- **WHEN** provider preset 将 Base URL 标记为 hidden、optional、required 或 fixed
- **THEN** 配置面板 SHALL 分别隐藏、允许编辑、要求填写或只读展示 Base URL
- **THEN** 保存时 SHALL 按 preset 规则写入或省略 provider profile 的 `baseURL`

#### Scenario: 切换 preset 同步 preset 默认字段
- **WHEN** 用户在 provider 详情页切换 provider preset
- **THEN** 配置面板 SHALL 将 provider 名称更新为新 preset 名称
- **THEN** 配置面板 SHALL 将模型列表替换为新 preset 的建议模型；若新 preset 没有建议模型，则 SHALL 清空旧模型列表

### Requirement: Provider 和模型编辑面板
配置面板 SHALL 提供 provider 列表页和 provider 详情页。列表页 SHALL 展示 provider 名称、API key 是否已设置、模型数量、显式新增 provider 选项、显式保存选项和当前选中状态；详情页 SHALL 支持编辑 provider 名称、API key、按 preset 可编辑的 Base URL、模型列表、显式新增模型、显式保存和默认模型选择。面板状态 SHALL 可作为纯 command session data 持久化，并在每个输入事件由 `/config` handler 继续处理。

#### Scenario: Provider 列表页
- **WHEN** 配置面板加载已有配置或空配置
- **THEN** 系统 SHALL 展示 provider 列表、当前保存状态和键盘操作提示
- **THEN** 用户 SHALL 能通过方向键移动，并通过 Enter 打开 provider、执行新增 provider 选项或执行保存选项
- **THEN** 系统 SHALL NOT 要求用户使用 `n`、`a` 或 Ctrl+S 这类隐藏快捷键完成新增或保存

#### Scenario: Provider 详情页编辑连接信息
- **WHEN** 用户打开某个 provider 详情页
- **THEN** 系统 SHALL 展示 provider preset、名称、API key 状态和 Base URL 状态
- **THEN** API key SHALL 以 masked 形式展示和编辑

#### Scenario: 模型列表编辑
- **WHEN** 用户在 provider 详情页管理模型
- **THEN** 系统 SHALL 支持通过显式新增模型选项新增模型 API id，并支持编辑和删除模型 API id
- **THEN** 系统 SHALL 为每个模型生成稳定的 model profile id，并将模型绑定到当前 provider

#### Scenario: 默认模型选择
- **WHEN** 配置中存在一个或多个模型 profile
- **THEN** 配置面板 SHALL 支持选择默认模型，或在保存时选择第一个有效模型作为 `llm.selectedModel`
- **THEN** 保存后的 `llm.selectedModel` SHALL 引用现有模型 profile id

#### Scenario: 保存前校验
- **WHEN** 用户尝试保存配置草稿
- **THEN** 系统 SHALL 校验 provider id、preset、API key、required Base URL、模型 id 和 provider 引用
- **THEN** 校验失败时 SHALL 在配置面板中显示可理解错误且 SHALL NOT 写入配置文件

### Requirement: Provider 模型枚举
配置面板 SHALL 在 provider 详情页的显式 `+ add model` 选项下方提供显式 `list models` 选项。用户激活该选项时，系统 SHALL 使用当前 provider 草稿的 preset、API key、Base URL 和隐藏 headers 调用该 provider 对应的模型枚举接口，并在 `/config` command surface 内展示可选模型列表。该流程 SHALL NOT 写入 transcript、启动 agent loop、进入 tool approval flow 或保存配置文件。

#### Scenario: 从远端模型列表添加模型
- **WHEN** 用户在 provider 详情页已提交有效 API key，并激活 `list models`
- **AND** provider preset 支持模型枚举且厂商接口返回一个或多个模型 id
- **THEN** 系统 SHALL 在 `/config` 面板内展示远端模型列表
- **AND** 用户选择某个模型 id 后，系统 SHALL 将该模型加入当前 provider 草稿或聚焦已有同名模型
- **AND** 系统 SHALL 返回 provider 详情页且不写入 `~/.echo/config.json`

#### Scenario: 模型枚举使用当前草稿连接参数
- **WHEN** 用户在 provider 详情页修改并提交 API key 或 Base URL 后激活 `list models`
- **THEN** 系统 SHALL 使用当前 command session 草稿中的连接参数发起请求
- **AND** fixed Base URL preset SHALL 使用 preset catalog 中的固定 Base URL，而不是用户草稿中的 Base URL
- **AND** 系统 SHALL 合并 preset headers 和现有 provider profile 中隐藏保留的字符串 headers

#### Scenario: 模型枚举加载状态
- **WHEN** 用户激活 `list models` 且请求尚未完成
- **THEN** 配置面板 SHALL 显示模型枚举 loading 状态
- **AND** footer SHALL 在请求完成后自动重绘为结果、空列表或错误状态

#### Scenario: Provider 不支持模型枚举
- **WHEN** 用户激活 `list models` 且当前 provider 协议不支持模型枚举
- **THEN** 配置面板 SHALL 显示可理解的 unsupported 提示
- **AND** 用户 SHALL 仍可通过 `+ add model` 手动新增模型 API id

#### Scenario: 模型枚举失败时保护敏感信息
- **WHEN** 模型枚举请求因鉴权、网络或 provider 响应错误失败
- **THEN** 配置面板 SHALL 显示脱敏后的错误信息
- **AND** 错误信息 SHALL NOT 包含 API key、Bearer token、Authorization header、x-api-key 或隐藏 headers 的值
- **AND** 系统 SHALL 保留当前 provider 草稿并允许用户继续编辑或手动添加模型

#### Scenario: 模型枚举不重复添加模型
- **WHEN** 远端模型列表中的某个模型 id 已存在于当前 provider 草稿
- **AND** 用户选择该模型 id
- **THEN** 系统 SHALL NOT 重复添加同名模型
- **AND** 系统 SHALL 返回 provider 详情页并聚焦已有模型行

#### Scenario: 模型枚举不影响未保存配置
- **WHEN** 用户完成一次模型枚举并选择模型
- **AND** 用户随后按 Esc 取消 `/config`
- **THEN** 系统 SHALL 关闭 command session
- **AND** 系统 SHALL NOT 修改 `~/.echo/config.json`

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

### Requirement: 终端交互与清理
配置面板 SHALL 使用现有 ANSI 控制序列、主 UI footer redraw 和 stdin raw mode 能力实现交互，不得切换 alternate screen。退出、取消、保存、Ctrl+C 或异常结束时，系统 SHALL 遵循主 UI 的终端清理路径恢复 raw mode、光标和 ANSI 样式。

#### Scenario: 不使用 alternate screen
- **WHEN** 用户在主 UI 中打开 `/config`
- **THEN** 系统 SHALL NOT 进入 terminal alternate screen
- **THEN** 面板 SHALL 通过主 UI footer command surface redraw 呈现

#### Scenario: 基础键盘操作
- **WHEN** 配置面板处于列表、详情或文本编辑状态
- **THEN** 系统 SHALL 支持方向键移动、Enter 激活或提交、Esc 返回或取消和 Ctrl+C 退出
- **THEN** 文本编辑 SHALL 支持普通可打印字符、Backspace 和中文字符输入

#### Scenario: 显式保存选项
- **WHEN** 用户在 provider 列表页或 provider 详情页移动到保存选项
- **AND** 用户按 Enter
- **THEN** 配置面板 SHALL 执行保存前校验和配置写入

#### Scenario: 退出恢复终端
- **WHEN** 主 UI 保存、取消 `/config` 或被 Ctrl+C 中断
- **THEN** 系统 SHALL 恢复终端 raw mode 状态、显示光标并重置 ANSI 样式
- **THEN** 后续 shell 输入 SHALL 不受配置面板影响

### Requirement: 默认 fake 配置与 /config 兼容
系统 SHALL 允许 bootstrap 创建的默认 fake agent 配置被 `/config` 读取，并在用户保存 provider/model 配置时继续遵循现有配置持久化和敏感信息保护规则。

#### Scenario: /config 读取默认 fake 配置
- **WHEN** `~/.echo/config.json` 是 bootstrap 创建的默认 fake 配置
- **AND** 用户提交纯 `/config`
- **THEN** 系统 SHALL 打开配置面板且不报配置缺失错误
- **THEN** 配置面板 SHALL 能展示或安全跳过 fake provider，而不得破坏现有 provider/model 草稿状态

#### Scenario: 保存真实 provider 时替换默认配置
- **WHEN** 用户从默认 fake 配置进入 `/config`
- **AND** 用户配置并保存有效真实 provider 和 model
- **THEN** 系统 SHALL 写入用户选择的 `llm.providers`、`llm.models` 和 `llm.selectedModel`
- **THEN** 系统 SHALL 继续使用原子写入方式保存 `~/.echo/config.json`

#### Scenario: 默认 fake 配置不引入敏感字段
- **WHEN** `/config` 读取 bootstrap 创建的默认配置
- **THEN** 配置面板 SHALL NOT 展示任何由 bootstrap 写入的真实 API key、Bearer token、x-api-key 或隐藏 header 值

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

### Requirement: Codex OAuth provider preset 配置
`/config` SHALL 支持 Codex OAuth provider preset。该 preset SHALL 表示使用本机已有 Codex/ChatGPT OAuth 登录态访问 Codex 订阅模型，配置面板 SHALL NOT 将其呈现为需要用户粘贴 API key 的 provider。

#### Scenario: provider 类型列表展示 Codex OAuth
- **WHEN** 用户新增 provider 并打开 provider preset 选择
- **THEN** 配置面板 SHALL 提供 Codex OAuth provider 选项
- **THEN** 该选项 SHALL 说明需要本机已有 Codex 登录态和 file-based auth cache
- **THEN** 该选项 SHALL NOT 要求用户输入 OpenAI Platform API key

#### Scenario: Codex OAuth 详情页隐藏 API key
- **WHEN** 用户打开 Codex OAuth provider 详情页
- **THEN** 配置面板 SHALL 隐藏或禁用 API key 编辑字段
- **THEN** 配置面板 SHALL 展示 Codex auth cache 来源摘要或缺失提示
- **THEN** 配置面板 SHALL NOT 展示 access token、refresh token 或 auth cache 原文

#### Scenario: 保存 Codex OAuth provider
- **WHEN** 用户保存包含 Codex OAuth provider 和至少一个模型 profile 的配置草稿
- **THEN** 保存校验 SHALL NOT 要求该 provider 配置 `apiKey`
- **THEN** 保存后的 provider profile SHALL 包含 Codex OAuth preset id
- **THEN** 保存后的 `~/.echo/config.json` SHALL NOT 包含 access token 或 refresh token

### Requirement: Codex OAuth provider 模型管理
`/config` SHALL 允许用户为 Codex OAuth provider 手动添加模型 id，并 SHALL 在 Codex OAuth credential 可用时支持从 Codex backend 枚举模型。该流程 SHALL 保持 command surface 内部交互，不写入 transcript，也不触发 assistant turn。

#### Scenario: 手动添加 Codex 模型
- **WHEN** 用户在 Codex OAuth provider 详情页激活 `+ add model`
- **THEN** 配置面板 SHALL 允许用户输入 Codex backend 模型 id
- **THEN** 模型 SHALL 绑定到当前 Codex OAuth provider
- **THEN** 保存前 SHALL NOT 修改 `~/.echo/config.json`

#### Scenario: 从 Codex backend 模型列表添加模型
- **WHEN** 用户在 Codex OAuth provider 详情页激活 `list models`
- **AND** Codex OAuth credential 可用且模型枚举成功
- **THEN** 配置面板 SHALL 展示 Codex backend 返回的可选模型 id
- **THEN** 用户选择模型后系统 SHALL 将该模型加入当前草稿或聚焦已有同名模型
- **THEN** 系统 SHALL 返回 provider 详情页且不写入 transcript

#### Scenario: Codex 模型枚举不可用时继续允许手动配置
- **WHEN** 用户在 Codex OAuth provider 详情页激活 `list models`
- **AND** Codex auth cache 缺失、过期刷新失败、网络失败或响应格式无效
- **THEN** 配置面板 SHALL 显示脱敏后的错误提示
- **THEN** 配置面板 SHALL 保留当前草稿
- **THEN** 用户 SHALL 仍可通过 `+ add model` 手动新增模型 id

### Requirement: Codex OAuth 配置敏感信息保护
`/config` SHALL 将 Codex OAuth auth cache 和 token 视为敏感凭据。配置读取、校验、保存、模型枚举和错误渲染 SHALL NOT 泄漏 access token、refresh token、Authorization header 或 auth cache 文件内容。

#### Scenario: 配置错误不泄漏 Codex token
- **WHEN** Codex OAuth provider 的 auth cache 读取、token 刷新或模型枚举失败
- **THEN** 配置面板 SHALL 显示可理解的脱敏错误
- **THEN** 错误 SHALL NOT 包含 access token、refresh token、Bearer token、Authorization header 或 auth cache 原文

#### Scenario: 取消 Codex OAuth 配置不持久化草稿
- **WHEN** 用户在 `/config` 中新增或编辑 Codex OAuth provider 后按 Esc 取消
- **THEN** 系统 SHALL 关闭 command session
- **THEN** 系统 SHALL NOT 修改 `~/.echo/config.json`
- **THEN** 系统 SHALL NOT 写入任何 Codex OAuth credential
