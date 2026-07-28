## ADDED Requirements

### Requirement: edit_file 写入审批策略
系统 SHALL 将 `edit_file` 视为受控写入型本地工具。Normal mode 的 `edit_file` 调用 SHALL 在进入普通 executor 前请求用户授权，并 SHALL 支持按工具名复用当前进程会话级授权；plan mode SHALL 在打开授权 surface 前直接拒绝；headless mode SHALL 继续遵守 deny-by-default 与显式 full-access 策略。

#### Scenario: normal mode 始终请求授权
- **WHEN** normal mode 的 agent loop runtime 收到 `edit_file` tool call，且当前会话没有适用的 allow 决策
- **THEN** 风险分类 SHALL 返回需要用户授权
- **THEN** 授权预览 SHALL 至少包含 `edit_file` 工具名和目标路径摘要，并 SHALL NOT 展开无界 old/new 文本

#### Scenario: plan mode 拒绝 edit_file
- **WHEN** plan mode 的 runtime 收到 `edit_file` tool call
- **THEN** 风险分类 SHALL 返回 plan-mode rejected
- **THEN** runtime SHALL NOT 打开授权 surface 或执行 handler
- **THEN** 失败结果 SHALL 提示退出 plan mode 后再修改文件

#### Scenario: 会话级授权按 edit_file 工具名复用
- **WHEN** 用户选择允许 `edit_file` 在当前会话执行
- **THEN** 当前调用 SHALL 执行
- **THEN** 当前 CLI 进程内后续仍需审批的 `edit_file` 调用 SHALL 不再打开授权 surface
- **THEN** 该授权 SHALL NOT 自动允许 `apply_patch` 或其他不同名称工具

#### Scenario: headless 默认拒绝与 full-access 放行
- **WHEN** headless run 收到 `edit_file` tool call
- **THEN** deny approval policy SHALL 返回需要显式 `--full-access` 的失败结果且不得修改文件
- **THEN** full-access approval policy SHALL 允许调用进入普通 executor

