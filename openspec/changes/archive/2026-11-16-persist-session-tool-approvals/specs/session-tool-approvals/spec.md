## ADDED Requirements

### Requirement: 会话级工具授权 sidecar 持久化
交互式 TUI SHALL 把会话级工具授权持久化到所属 session 的 sidecar 文件 `<sessionId>.approvals.json`，与同目录 `<sessionId>.jsonl` journal 和 `<sessionId>.settings.json` 并列。sidecar SHALL 由 `TranscriptStore` 的 session 路径派生，使授权生命周期与 session 一一对应。sidecar SHALL NOT 写入 transcript journal，SHALL NOT 写入 `~/.echo/config.json`。

#### Scenario: 会话级授权写入 sidecar
- **WHEN** 用户在工具授权 surface 选择 `Allow <toolName> for this session` 或 `Allow this command for this session`
- **THEN** 系统 SHALL 在当前 session 的 sidecar 中记录该项授权
- **THEN** 系统 SHALL NOT 修改 transcript journal 或 `~/.echo/config.json`

#### Scenario: 关闭全部授权时同步更新 sidecar
- **WHEN** 用户通过 `Shift+Tab` 或 `Allow all tools for this session` 打开全部授权
- **THEN** sidecar SHALL 记录 `allowAll` 为真
- **THEN** 用户再次切换为关闭后，sidecar SHALL 记录 `allowAll` 为假

#### Scenario: 空授权不落盘
- **WHEN** 当前会话没有任何工具授权、命令授权且 `allowAll` 为假
- **THEN** 系统 SHALL NOT 创建或保留 sidecar 文件
- **THEN** 已存在的 sidecar SHALL 被删除

#### Scenario: sidecar 采用原子替换
- **WHEN** 系统写入 sidecar
- **THEN** 系统 SHALL 先写临时文件再 rename 到目标路径
- **THEN** 目标文件 SHALL NOT 出现半写入的 JSON 内容

### Requirement: 会话级工具授权 sidecar 读取与失效
系统 SHALL 在 `/resume` 加载会话成功后从该 session 的 sidecar 恢复授权，并在 `/fork` 创建新会话后把当前授权写入新 session。sidecar 缺失、损坏、版本不支持或会话身份不匹配时，系统 SHALL 视为空授权集合，SHALL NOT 视为全部放行。系统 SHALL NOT 因为 sidecar 读取失败而中断当前 turn 或阻止会话恢复。

#### Scenario: 恢复会话后授权继续生效
- **WHEN** 用户在会话中批准过某个工具，随后重启 echo-tui 并用 `/resume` 恢复同一会话
- **AND** 该工具再次被分类为 `approval_required`
- **THEN** 系统 SHALL 命中会话授权缓存并立即返回允许决策
- **THEN** TUI SHALL NOT 打开 tool approval surface

#### Scenario: 恢复后状态栏反映全部授权
- **WHEN** `/resume` 恢复的会话 sidecar 记录 `allowAll` 为真
- **THEN** status line SHALL 显示 `TOOLS all`

#### Scenario: fork 继承当前授权
- **WHEN** 当前会话存在授权时用户执行 `/fork`
- **THEN** 新 session 的 sidecar SHALL 包含与源会话相同的授权
- **THEN** 源会话的 sidecar SHALL 保持不变

#### Scenario: 损坏 sidecar 回退为需要审批
- **WHEN** sidecar 内容不是有效 JSON、`schemaVersion` 不受支持或 `sessionId` 与请求不一致
- **THEN** 系统 SHALL 把该会话的授权视为空集合
- **THEN** 后续 `approval_required` 调用 SHALL 继续进入审批流程
- **THEN** 系统 SHALL NOT 因为该错误中断会话恢复

#### Scenario: 单个脏条目只丢弃自己
- **WHEN** sidecar 的 `tools` 或 `bashCommands` 数组中包含空白字符串或非字符串条目
- **THEN** 系统 SHALL 丢弃这些条目并保留同一文件中的其余有效授权
- **THEN** 系统 SHALL NOT 因为单个脏条目而清空整个会话授权

#### Scenario: updatedAt 不参与读取判定
- **WHEN** sidecar 缺失 `updatedAt` 或该字段格式异常
- **THEN** 系统 SHALL 正常读取其余授权
- **THEN** 系统 SHALL NOT 因为该诊断字段而回退为空集合

#### Scenario: 删除会话时清理 sidecar
- **WHEN** 用户通过 `/resume` 删除一个历史会话
- **THEN** 系统 SHALL 尽力删除对应 sidecar
- **THEN** sidecar 清理失败 SHALL NOT 改变已提交的 journal 删除结果

#### Scenario: 新会话从空授权开始
- **WHEN** 用户执行 `/clear` 开启新会话
- **THEN** 内存中的会话授权 SHALL 被清空
- **THEN** 新 session SHALL 在用户重新批准前不继承任何授权
