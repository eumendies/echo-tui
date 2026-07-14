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
系统 SHALL 提供 `/memory` 本地 slash command，并在同一管理流程中区分 user memory 与 agent memory。`/memory` SHALL 是 user memory 唯一的读取与 mutation 入口；User memory 列表 SHALL 保留启停 toggle、截断预览、导航、新增、原地编辑和删除确认。Agent memory SHALL 支持按 global/project scope 浏览 catalog、进入 item 列表、编辑 catalog 名称和描述，以及新增、编辑、启停和删除 catalog/item。Catalog 和 item 列表 SHALL 显示各自 enabled 状态，并 SHALL 使用 Space 切换选中对象；disabled 对象 SHALL 保留在管理列表中。该命令 SHALL NOT 触发 provider 请求或追加 transcript record。

#### Scenario: 选择 memory 类型
- **WHEN** 用户提交 `/memory`
- **THEN** 系统 SHALL 提供 user memory 与 agent memory 的可识别入口
- **THEN** 系统 SHALL NOT 将 `/memory` 提交给 agent

#### Scenario: 管理 user memory
- **WHEN** 用户进入 user memory 管理
- **THEN** 系统 SHALL 保留已有列表导航、Space 启停、新增、编辑、删除确认和 Esc 返回语义
- **THEN** user memory mutation SHALL 通过 `/memory` 的本地管理流程执行，而不是通过 provider memory tools 执行

#### Scenario: 浏览 agent catalog 和 item
- **WHEN** 用户进入 agent memory 管理
- **THEN** surface SHALL 显示 catalog 所属 global/project scope和 enabled 状态
- **THEN** 用户 SHALL 能进入选中 catalog 查看全部 enabled/disabled items
- **THEN** item 列表 SHALL 显示每个 item 的 enabled 状态

#### Scenario: 切换 agent catalog 状态
- **WHEN** 用户在 agent catalog 列表中对选中项按下 Space
- **THEN** 系统 SHALL 持久化相反的 enabled 状态
- **THEN** 当前 surface 和 `/memory` session cache SHALL 使用保存后的 catalog 列表更新

#### Scenario: 切换 agent item 状态
- **WHEN** 用户在 agent item 列表中对选中项按下 Space
- **THEN** 系统 SHALL 持久化相反的 enabled 状态并更新该 item 的 `updatedAt`
- **THEN** 当前 surface 和 `/memory` session cache SHALL 使用保存后的 item 列表更新

#### Scenario: 一级菜单统计全部 item
- **WHEN** `/memory` 显示 global/project agent memory item count
- **THEN** count SHALL 包含 enabled 和 disabled items

#### Scenario: 编辑 agent catalog 和 item
- **WHEN** 用户新增或编辑 agent catalog 元数据或 item 内容
- **THEN** surface SHALL 在 memory 卡片内使用可见真实终端光标维护草稿
- **THEN** 成功保存后 SHALL 刷新对应 catalog 或 item 列表

#### Scenario: 取消编辑不改变已保存数据
- **WHEN** 用户正在编辑任一 user/agent memory 草稿并按下 Esc
- **THEN** 系统 SHALL 丢弃未保存草稿并返回上一层列表
- **THEN** 已保存的 memory 文件 SHALL 保持不变

#### Scenario: 保存失败保留管理状态
- **WHEN** user 或 agent memory mutation 无法保存
- **THEN** 系统 SHALL 保持当前管理 surface 打开并显示可读错误
- **THEN** 编辑操作的未保存草稿 SHALL 保留供用户修正或取消
- **THEN** 启停失败 SHALL NOT 改变当前 surface 或 session cache 中的 enabled 状态

