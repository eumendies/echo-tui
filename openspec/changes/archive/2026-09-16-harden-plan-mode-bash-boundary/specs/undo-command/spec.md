## MODIFIED Requirements

### Requirement: 不可追踪写入保护和确认恢复
包含不可追踪写入型 shell 命令的 assistant loop SHALL 使 change checkpoint 失效；但当命令实际在生效 `read-only` 沙箱内执行时，工作区写入已被内核边界排除，系统 SHALL NOT 因该命令使 checkpoint 失效。对于 ready checkpoint 中由受控文件工具记录的文件，用户确认 `/undo` 后系统 SHALL 恢复 checkpoint 的 snapshot 状态，即使这些文件在 loop 结束后又被手动修改。

#### Scenario: 写入型 bash 使 undo 不可用
- **WHEN** assistant loop 执行了无法声明文件修改集合的写入型 `run_bash_command`，且该命令未在生效 `read-only` 沙箱内执行
- **THEN** 系统 SHALL 将本轮 change checkpoint 标记为 invalid
- **THEN** 系统 SHALL 丢弃该 invalid checkpoint 之前的 checkpoint
- **WHEN** 用户随后提交 `/undo`
- **THEN** 系统 SHALL 说明本轮包含不可追踪写入命令，无法安全回退
- **THEN** 系统 SHALL NOT 修改文件系统或 transcript records

#### Scenario: 生效只读沙箱内执行不使 undo 失效
- **WHEN** assistant loop 在生效 `read-only` 沙箱内执行了无法声明文件修改集合的 bash 命令，例如 `jq . package.json` 或 `node -e "..."`
- **THEN** 系统 SHALL NOT 使本轮 change checkpoint 失效
- **THEN** `/undo` MAY 继续回退该 loop 中受控文件工具产生的修改

#### Scenario: invalid checkpoint 作为多轮 undo 边界
- **GIVEN** 当前 session change history 内存在一个 invalid checkpoint
- **AND** 该 invalid checkpoint 之后又产生了 ready checkpoint
- **WHEN** 用户连续确认 `/undo` 回退完 invalid checkpoint 之后的 ready checkpoint
- **THEN** 下一次 `/undo` SHALL 显示 invalid checkpoint 的不可回退说明
- **THEN** 系统 SHALL NOT 继续回退 invalid checkpoint 之前的 loop

#### Scenario: 只读 bash 不影响 undo 可用性
- **WHEN** assistant loop 只执行只读 inspection bash 命令且其他文件修改均来自受控文件工具
- **THEN** 只读 bash SHALL NOT 单独使 change checkpoint 失效
- **THEN** `/undo` MAY 继续回退该 loop 中受控文件工具产生的修改

#### Scenario: loop 后手动修改受控文件
- **WHEN** ready checkpoint 中某个受影响文件在 loop 结束后又被用户或外部进程修改
- **AND** 用户确认 `/undo`
- **THEN** 系统 SHALL 将该文件恢复为 checkpoint 记录的 snapshot 状态
- **THEN** 系统 SHALL 同步截断 transcript records
- **THEN** 系统 SHALL NOT 因当前文件状态不同于 loop 结束状态而拒绝 undo

#### Scenario: 文件恢复写入失败
- **WHEN** `/undo` 恢复文件过程中发生文件系统错误
- **THEN** 系统 SHALL 报告失败
- **THEN** 系统 SHALL NOT 截断 transcript records
- **THEN** 系统 SHALL 保留 checkpoint 供用户处理问题后重试或取消
