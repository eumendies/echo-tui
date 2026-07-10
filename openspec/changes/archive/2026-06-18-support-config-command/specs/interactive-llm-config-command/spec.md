## ADDED Requirements

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

### Requirement: 配置持久化
`/config` 命令 SHALL 读取和写入 `~/.echo/config.json`。保存时 SHALL 写入 `llm.providers`、`llm.models` 和 `llm.selectedModel` 的 provider-backed preset 配置结构，并 SHALL 保留 root 上与 LLM 配置面板无关的配置节点。写入 SHALL 使用临时文件加 rename 的原子写入方式。

#### Scenario: 首次保存创建配置文件
- **WHEN** `~/.echo/config.json` 不存在且用户在配置面板中保存有效 provider 和模型
- **THEN** 系统 SHALL 创建父目录和配置文件
- **THEN** 文件内容 SHALL 包含有效的 `llm.providers`、`llm.models` 和 `llm.selectedModel`

#### Scenario: 保存保留无关配置
- **WHEN** 现有配置文件包含 `tools`、render 或其他非 `llm.providers/models/selectedModel` 配置
- **THEN** `/config` 保存时 SHALL 保留这些无关配置
- **THEN** 系统 SHALL 只替换或更新配置面板负责管理的 LLM provider/model 配置

#### Scenario: 保存保留 provider 隐藏 headers
- **WHEN** 现有 provider profile 包含配置面板不展示的字符串 `headers`
- **THEN** `/config` 保存该 provider 时 SHALL 保留这些 headers
- **THEN** 系统 SHALL NOT 在配置面板中显示 header 值

#### Scenario: 原子写入配置
- **WHEN** 用户确认保存有效配置
- **THEN** 系统 SHALL 先写入同目录临时文件
- **THEN** 系统 SHALL 通过 rename 替换目标配置文件

#### Scenario: 敏感字段不出现在错误文本
- **WHEN** 配置读取、校验或保存失败
- **THEN** 系统 SHALL 输出不包含 API key、Bearer token、x-api-key 或其他敏感凭据的错误信息
- **THEN** 配置面板 SHALL 继续隐藏已输入 API key 的明文

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
