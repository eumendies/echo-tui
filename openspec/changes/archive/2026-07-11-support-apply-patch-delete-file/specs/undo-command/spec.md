## MODIFIED Requirements

### Requirement: 受控文件修改 change history
系统 SHALL 在 assistant loop 开始时创建 change checkpoint，并 SHALL 在受控文件编辑工具写入、创建或删除文件前记录目标文件的 snapshot 状态，在单个文件写入、创建或删除成功后立即将该文件标记为 `created` 或 `updated`。删除已有文件 SHALL 使用 `updated` 或等价可恢复状态记录原始 snapshot。第一版受控文件编辑工具 SHALL 至少包含 `apply_patch`。change history SHALL 随当前 transcript session 持久化，并 SHALL 按 assistant loop 顺序形成可连续回退的栈。

#### Scenario: 记录更新已有文件
- **WHEN** assistant loop 中 `apply_patch` 成功更新已有 UTF-8 文本文件
- **THEN** change checkpoint SHALL 记录该文件的绝对路径、snapshot content 和 `updated` 状态
- **THEN** `/undo` 成功时 SHALL 将该文件恢复为 snapshot content

#### Scenario: 记录新增文件
- **WHEN** assistant loop 中 `apply_patch` 成功新增 UTF-8 文本文件
- **THEN** change checkpoint SHALL 记录该文件在 loop 前不存在和 `created` 状态
- **THEN** `/undo` 成功时 SHALL 删除该新增文件

#### Scenario: 记录删除已有文件
- **WHEN** assistant loop 中 `apply_patch` 成功删除已有 UTF-8 文本文件
- **THEN** change checkpoint SHALL 记录该文件的绝对路径、snapshot content 和 `updated` 或等价可恢复状态
- **THEN** `/undo` 成功时 SHALL 重新创建该文件并恢复为 snapshot content

#### Scenario: 同一 loop 多次修改同一文件
- **WHEN** 同一 assistant loop 中受控文件工具多次修改同一文件
- **THEN** change checkpoint SHALL 保留该文件第一次修改前的 snapshot 状态
- **THEN** change checkpoint SHALL 在任意一次成功写入、创建或删除后保持 `created` 或 `updated` 状态

#### Scenario: snapshot-only entry 不参与 undo
- **WHEN** 受控文件工具记录了文件 snapshot 状态但没有成功写入、创建或删除该文件
- **THEN** change checkpoint SHALL 保留该文件的 `pending` 状态
- **THEN** `/undo` 摘要 SHALL NOT 计入该文件
- **THEN** `/undo` 执行时 SHALL NOT 恢复该文件

#### Scenario: 解析校验模拟失败不产生 change entry
- **WHEN** `apply_patch` 解析、校验或模拟失败
- **THEN** 该失败调用 SHALL NOT 记录为可回退文件修改

#### Scenario: 写盘阶段失败保留已成功写入文件
- **WHEN** `apply_patch` 写盘阶段部分文件已经写入、创建或删除成功
- **AND** 后续文件写入、创建或删除失败
- **THEN** change checkpoint SHALL 保留已成功写入、创建或删除文件的 `created` 或 `updated` 状态
- **THEN** change checkpoint SHALL 保留未成功写入、创建或删除文件的 `pending` 状态
- **THEN** 系统 SHALL NOT 将该 change checkpoint 标记为 invalid
- **THEN** `/undo` SHALL 只恢复已成功写入、创建或删除的文件并回退 transcript

#### Scenario: change history 随 session 恢复
- **WHEN** 用户退出并重新启动 TUI
- **AND** 用户通过 `/resume` 加载包含 change history 的 transcript session
- **THEN** 系统 SHALL 从 transcript session 中恢复旧 change checkpoint
- **THEN** `/undo` SHALL 可以回退上一进程中的受控文件修改
