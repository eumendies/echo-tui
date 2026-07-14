## MODIFIED Requirements

### Requirement: memory 在每次真实 provider 请求中持久携带
系统 SHALL 在每次真实 provider 请求构造时读取全部有效且已启用的用户 memory，并将其格式化为 transient 的 `User-managed memories` 内置 system prompt 区块。该区块 SHALL 说明 memory 是用户提供的持久背景，且不得覆盖内置系统约束或当前用户请求。memory SHALL NOT 被追加为 transcript record、持久化 session record 或 compaction summary 输入。

#### Scenario: 新会话携带已有 memory
- **WHEN** 用户启动新的会话并提交触发真实 provider 请求的消息
- **AND** 用户 memory 存储包含有效条目
- **THEN** provider request SHALL 包含全部有效且启用的 memory 的 transient context
- **THEN** app transcript SHALL NOT 因 memory 注入新增 record

#### Scenario: 管理后下一次请求使用最新 memory
- **WHEN** 用户通过 `/memory` 或 agent 通过获批的 memory mutation 工具成功新增、编辑、启停或删除 user memory
- **AND** 随后构造真实 provider request
- **THEN** 该请求 SHALL 基于保存后的 memory 文件构造 context
- **THEN** 系统 SHALL NOT 继续使用进程启动时的旧 memory 快照

### Requirement: `/memory` 管理 command surface
系统 SHALL 提供 `/memory` 本地 slash command，并在同一管理流程中区分 user memory 与 agent memory。User memory 列表 SHALL 保留启停 toggle、截断预览、导航、新增、原地编辑和删除确认；agent memory SHALL 支持按 global/project scope 浏览 catalog、进入 item 列表、编辑 catalog 名称和描述，以及新增、编辑和删除 item。该命令 SHALL NOT 触发 provider 请求或追加 transcript record。

#### Scenario: 选择 memory 类型
- **WHEN** 用户提交 `/memory`
- **THEN** 系统 SHALL 提供 user memory 与 agent memory 的可识别入口
- **THEN** 系统 SHALL NOT 将 `/memory` 提交给 agent

#### Scenario: 管理 user memory
- **WHEN** 用户进入 user memory 管理
- **THEN** 系统 SHALL 保留已有列表导航、Space 启停、新增、编辑、删除确认和 Esc 返回语义

#### Scenario: 浏览 agent catalog 和 item
- **WHEN** 用户进入 agent memory 管理
- **THEN** surface SHALL 显示 catalog 所属 global/project scope
- **THEN** 用户 SHALL 能进入选中 catalog 查看和管理其 items

#### Scenario: 编辑 agent catalog 和 item
- **WHEN** 用户新增或编辑 agent catalog 元数据或 item 内容
- **THEN** surface SHALL 在 memory 卡片内使用可见真实终端光标维护草稿
- **THEN** 成功保存后 SHALL 刷新对应 catalog 或 item 列表

#### Scenario: 取消编辑不改变已保存数据
- **WHEN** 用户正在编辑任一 user/agent memory 草稿并按下 Esc
- **THEN** 系统 SHALL 丢弃未保存草稿并返回上一层列表
- **THEN** 已保存的 memory 文件 SHALL 保持不变

#### Scenario: 保存失败保留草稿
- **WHEN** user 或 agent memory mutation 无法保存
- **THEN** 系统 SHALL 保持当前管理 surface 打开并显示可读错误
- **THEN** 编辑操作的未保存草稿 SHALL 保留供用户修正或取消

## ADDED Requirements

### Requirement: Agent 可经工具修改 user memory
系统 SHALL 允许 `add_memory`、`update_memory` 和 `remove_memory` 在 `type: user` 时操作现有 user memory 存储，使 agent 能响应用户明确的记忆请求。工具 SHALL 保留 user memory 的版本、非空校验、enabled 状态和原子保存语义，并 SHALL NOT 将 user memory 转存到 agent memory catalog。

#### Scenario: Agent 添加 user memory
- **WHEN** 用户要求 agent 记住稳定信息且获批的 `add_memory` 使用 user 类型
- **THEN** 系统 SHALL 向 `~/.echo/memories.json` 添加默认启用的 user memory
- **THEN** 下一次 provider request SHALL 自动注入该条目

#### Scenario: Agent 更新或删除 user memory
- **WHEN** 获批的 `update_memory` 或 `remove_memory` 使用 user 类型和有效 item id
- **THEN** 系统 SHALL 更新或删除对应 user memory 条目
- **THEN** 系统 SHALL NOT 修改 agent memory 存储

