## ADDED Requirements

### Requirement: edit_file change checkpoint 集成
成功的 `edit_file` 写入 SHALL 作为受控文件修改进入当前 assistant loop 的 change checkpoint，并 SHALL 使用现有 session 持久化、连续回退、snapshot-only 过滤和 transcript/compaction 一致回退语义。失败且未写盘的 `edit_file` 调用 SHALL NOT 形成可回退文件修改。

#### Scenario: edit_file 更新可回退
- **WHEN** assistant loop 中 `edit_file` 成功更新已有 UTF-8 文本文件
- **THEN** change checkpoint SHALL 记录该文件第一次修改前的绝对路径、snapshot content 和 `updated` 状态
- **THEN** 用户成功执行 `/undo` 时 SHALL 恢复 snapshot content

#### Scenario: 同一 loop 与 apply_patch 共同修改
- **WHEN** 同一 assistant loop 中 `edit_file` 与其他受控文件工具先后修改同一解析后路径
- **THEN** change checkpoint SHALL 只保留该路径第一次修改前的 snapshot
- **THEN** checkpoint SHALL 在任意成功写入后保持 `updated` 或原有 `created` 状态

#### Scenario: edit_file 校验失败不计入 undo
- **WHEN** `edit_file` 因参数、目标、匹配数量或 post-image 校验失败且没有写盘
- **THEN** `/undo` 摘要 SHALL NOT 将该调用计为文件修改
- **THEN** `/undo` 执行 SHALL NOT 因该失败调用恢复目标文件

#### Scenario: edit_file history 随 session 恢复
- **WHEN** session 保存了包含 `edit_file` 更新的 ready checkpoint
- **AND** 用户在新进程中通过 `/resume` 加载该 session
- **THEN** `/undo` SHALL 可以回退该 `edit_file` 文件修改及对应 assistant loop transcript

