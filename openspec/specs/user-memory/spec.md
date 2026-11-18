# user-memory Specification

## Purpose
定义用户级 memory 的持久化存储、provider transient 注入和 `/memory` 管理 command surface 行为。
## Requirements
### Requirement: 用户级 memory JSON 存储
系统 SHALL 将用户显式管理的 memory 存储在 `~/.echo/memories.json`。文件根节点 SHALL 是包含 `version: 1` 和 `memories` 数组的 JSON 对象；每个 memory SHALL 包含稳定的 `id`、非空字符串 `content`、布尔值 `enabled`、`createdAt` 和 `updatedAt`。读取缺失文件 SHALL 返回空 memory 列表；保存 SHALL 创建父目录并采用临时文件 rename 的原子替换。缺少 `enabled` 的既有条目 SHALL 视为启用。

#### Scenario: 首次新增 memory
- **WHEN** 用户在没有 `~/.echo/memories.json` 的环境中确认新增有效 memory
- **THEN** 系统 SHALL 创建父目录和符合版本化格式的 JSON 文件
- **THEN** 保存后的列表 SHALL 包含具有 id、时间戳和 `enabled: true` 的新条目

#### Scenario: 读取缺失的 memory 文件
- **WHEN** 系统读取 memory 且默认文件不存在
- **THEN** 系统 SHALL 返回空列表
- **THEN** 系统 SHALL NOT 将该缺失视为错误

#### Scenario: 无效文件不被覆盖
- **WHEN** memory 文件不是有效 JSON、根节点格式无效或包含无效 memory 条目
- **THEN** 系统 SHALL 返回可展示的读取诊断
- **THEN** `/memory` SHALL NOT 用空列表覆盖原文件

### Requirement: memory 在每次真实 provider 请求中持久携带
系统 SHALL 在每次真实 provider 请求构造时读取全部有效且已启用的用户 memory，并将其格式化为 transient 的 `User-managed memories` 内置 system prompt 区块。该区块 SHALL 说明 memory 是用户提供的持久背景，且不得覆盖内置系统约束或当前用户请求。memory SHALL NOT 被追加为 transcript record、持久化 session record 或 compaction summary 输入。

#### Scenario: 新会话携带已有 memory
- **WHEN** 用户启动新的会话并提交触发真实 provider 请求的消息
- **AND** 用户 memory 存储包含有效条目
- **THEN** provider request SHALL 包含全部有效且启用的 memory 的 transient context
- **THEN** app transcript SHALL NOT 因 memory 注入新增 record

#### Scenario: 管理后下一次请求使用最新 memory
- **WHEN** 用户通过 `/memory` 成功新增、编辑、启停或删除 user memory
- **AND** 随后构造真实 provider request
- **THEN** 该请求 SHALL 基于保存后的 memory 文件构造 context
- **THEN** 系统 SHALL NOT 继续使用进程启动时的旧 memory 快照

### Requirement: `/memory` 管理 command surface
系统 SHALL 提供 `/memory` 本地 slash command，并在同一管理流程中区分 user memory 与 agent memory。`/memory` SHALL 是 user memory 唯一的读取与 mutation 入口。该命令 SHALL NOT 触发 provider 请求或追加 transcript record。

管理面板 SHALL 由一个固定层级的可聚焦行列表组成：类型选择 → user memory 列表或 agent catalog 列表 → user memory 详情或 agent catalog 详情 → agent item 详情。handler 与 renderer SHALL 共用同一份行投影；每一行 SHALL 声明自身角色（条目、动作、开关、只读字段或选项），Enter 的语义 SHALL 由当前行角色决定，管理动作 SHALL NOT 依赖字母快捷键。

Up 与 Down SHALL 只在当前层级的行之间移动焦点，Enter SHALL 打开选中条目或执行选中动作，Esc SHALL 返回上一层。从详情层返回父列表时，焦点 SHALL 落在进入详情前的同一行。

user memory 详情层与 agent item 详情层 SHALL 展示完整内容、启停开关行、编辑动作行和删除动作行。agent catalog 详情层 SHALL 展示 catalog 名称、描述、启停状态和 item 列表，并 SHALL 提供新增 item、编辑 catalog、删除 catalog 三个动作行。

每个列表层 SHALL 在行列表末尾常驻一个新增动作行，使空列表也能通过 Enter 进入新建流程。删除 SHALL 只由删除动作行触发，并 SHALL 进入包含“取消”和“删除”两个可聚焦选项的确认层，默认焦点 SHALL 落在“取消”。启停 SHALL 同时支持 Enter 与 Space，Space SHALL 作为开关行和列表条目的快捷切换保留。disabled 对象 SHALL 保留在管理列表中。新增与编辑 SHALL 在 memory 卡片内使用可见真实终端光标维护草稿。

#### Scenario: 选择 memory 类型
- **WHEN** 用户提交 `/memory`
- **THEN** 系统 SHALL 提供 user memory 与 agent memory 的可识别入口行
- **THEN** 系统 SHALL NOT 将 `/memory` 提交给 agent

#### Scenario: 管理 user memory
- **WHEN** 用户进入 user memory 列表
- **THEN** 系统 SHALL 保留截断预览、导航、启停、新增、编辑和删除确认能力
- **THEN** 每个能力 SHALL 由可聚焦行 + Enter 触达，SHALL NOT 要求字母快捷键
- **THEN** user memory mutation SHALL 通过 `/memory` 的本地管理流程执行，而不是通过 provider memory tools 执行

#### Scenario: 管理动作以可聚焦行呈现
- **WHEN** `/memory` 在任一层级渲染管理动作
- **THEN** 新增、编辑、删除、返回等动作 SHALL 各自对应一个可见行
- **THEN** 该行被 Enter 激活时 SHALL 执行对应动作
- **THEN** 底部按键提示 SHALL 只包含 Up、Down、Enter、Space、Esc 等导航与确认按键，SHALL NOT 包含 a、e、d 之类的动作字母键

#### Scenario: 空列表通过新增动作行进入新建
- **WHEN** user memory、catalog 或 item 列表没有任何条目
- **THEN** 该列表 SHALL 仍然渲染新增动作行，并 SHALL 允许用户把焦点移动到该行
- **THEN** 用户在该行按 Enter SHALL 进入对应的新建编辑流程
- **THEN** 空列表 SHALL NOT 只通过字母快捷键提供新建入口

#### Scenario: 详情层展示完整内容与动作
- **WHEN** 用户在 user memory 列表或 agent item 列表中对某一条目按 Enter
- **THEN** 系统 SHALL 打开该条目的详情层
- **THEN** 详情层 SHALL 展示未截断的完整内容
- **THEN** 详情层 SHALL 提供启停开关行、编辑动作行和删除动作行

#### Scenario: 一级菜单统计全部 item
- **WHEN** `/memory` 显示 global、project agent memory item count
- **THEN** count SHALL 包含 enabled 和 disabled items

#### Scenario: 浏览 agent catalog 和 item
- **WHEN** 用户进入 agent memory 管理
- **THEN** catalog 列表层 SHALL 显示 catalog 所属 global、project scope 和 enabled 状态
- **THEN** 用户在选中 catalog 上按 Enter SHALL 进入 catalog 详情层
- **THEN** catalog 详情层 SHALL 显示该 catalog 的全部 enabled 和 disabled items 及各自 enabled 状态
- **THEN** catalog 详情层 SHALL 显示 catalog 名称、描述与启停状态

#### Scenario: 编辑 agent catalog 和 item
- **WHEN** 用户通过 catalog 详情层的动作行编辑 catalog 元数据，或通过 item 详情层的动作行编辑内容
- **THEN** surface SHALL 在 memory 卡片内使用可见真实光标维护草稿
- **THEN** 成功保存后 SHALL 刷新对应 catalog 或 item 列表并回到进入编辑前的层级

#### Scenario: 切换 agent catalog 状态
- **WHEN** 用户在 agent catalog 列表中对选中项按下 Space 或 Enter
- **THEN** 系统 SHALL 持久化相反的 enabled 状态
- **THEN** 当前 surface 和 `/memory` session cache SHALL 使用保存后的 catalog 列表更新

#### Scenario: 切换 agent item 状态
- **WHEN** 用户在 agent item 详情层或 agent item 列表中对选中项按下 Space 或触发展开开关行
- **THEN** 系统 SHALL 持久化相反的 enabled 状态并更新该 item 的 `updatedAt`
- **THEN** 当前 surface 和 `/memory` session cache SHALL 使用保存后的 item 列表更新

#### Scenario: 删除确认默认取消
- **WHEN** 用户在详情层选择删除动作行
- **THEN** 系统 SHALL 打开包含“取消”和“删除”两个可聚焦选项的确认层
- **THEN** 默认焦点 SHALL 落在“取消”
- **THEN** 用户移动焦点到“删除”并按 Enter 后，系统 SHALL 执行删除
- **THEN** 用户按 Esc SHALL 关闭确认层并保留原数据

#### Scenario: 详情返回恢复父列表焦点
- **WHEN** 用户从 user memory 详情、catalog 详情或 item 详情按 Esc 返回父列表
- **THEN** 焦点 SHALL 落在进入详情前的同一行
- **THEN** 系统 SHALL NOT 把焦点重置到列表首行

#### Scenario: 取消编辑不改变已保存数据
- **WHEN** 用户正在编辑任一 user、agent memory 草稿并按下 Esc
- **THEN** 系统 SHALL 丢弃未保存草稿并返回上一层
- **THEN** 已保存的 memory 文件 SHALL 保持不变

#### Scenario: 保存失败保留管理状态
- **WHEN** user 或 agent memory mutation 无法保存
- **THEN** 系统 SHALL 保持当前管理 surface 打开并显示可读错误
- **THEN** 编辑操作的未保存草稿 SHALL 保留供用户修正或取消
- **THEN** 启停失败 SHALL NOT 改变当前 surface 或 session cache 中的 enabled 状态

