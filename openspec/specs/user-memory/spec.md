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
- **WHEN** 用户通过 `/memory` 成功新增、编辑或删除条目
- **AND** 用户随后提交触发真实 provider 请求的消息
- **THEN** 该请求 SHALL 基于保存后的 memory 文件构造 context
- **THEN** 系统 SHALL NOT 继续使用进程启动时的旧 memory 快照

### Requirement: `/memory` 管理 command surface
系统 SHALL 提供 `/memory` 本地 slash command，并打开专用的 memory 管理 surface。列表 SHALL 显示 memory 条目的启停 toggle、可识别截断预览和当前选中项，并支持上/下移动。用户 SHALL 能通过 Space 启停选中项、`a` 新增、Enter 或 `e` 编辑选中项、`d` 进入删除确认，以及通过 Esc 关闭或返回列表；该命令 SHALL NOT 触发 provider 请求或追加 transcript record。

#### Scenario: 浏览 memory 列表
- **WHEN** 用户提交 `/memory`
- **THEN** 系统 SHALL 打开包含已保存 memory 预览的管理 surface
- **THEN** 系统 SHALL 支持用户移动当前选中项
- **THEN** 系统 SHALL 显示每项的启用状态
- **THEN** 系统 SHALL NOT 将 `/memory` 提交给 agent

#### Scenario: 切换 memory 启用状态
- **WHEN** 用户在 memory 列表中按下 Space
- **THEN** 系统 SHALL 切换选中条目的启用状态并立即持久化
- **THEN** 停用条目 SHALL 不进入后续 provider request 的 memory context

#### Scenario: 新增和编辑多行 memory
- **WHEN** 用户在 memory 列表中新增条目或编辑选中条目
- **THEN** 系统 SHALL 在同一 memory 管理卡片中原地展开编辑输入区并维护未保存草稿
- **THEN** 系统 SHALL 支持文本编辑、光标移动、退格和 `Ctrl+J` 插入换行
- **THEN** 用户按 Enter 时，系统 SHALL 仅在内容非空时保存，并返回列表

#### Scenario: 取消编辑不改变已保存数据
- **WHEN** 用户正在新增或编辑 memory 草稿
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 丢弃该草稿并返回列表
- **THEN** 已保存的 memory 文件 SHALL 保持不变

#### Scenario: 删除需要确认
- **WHEN** 用户在列表中对选中 memory 按下 `d`
- **THEN** 系统 SHALL 显示删除确认状态
- **WHEN** 用户在确认状态按下 Enter
- **THEN** 系统 SHALL 删除选中条目、持久化更新后的列表并返回列表状态

#### Scenario: 保存失败保留用户草稿
- **WHEN** 用户确认新增、编辑或删除，但 memory 文件无法保存
- **THEN** 系统 SHALL 保持当前管理 surface 打开
- **THEN** 系统 SHALL 显示可读错误信息
- **THEN** 编辑操作的未保存草稿 SHALL 保留供用户修正或取消
