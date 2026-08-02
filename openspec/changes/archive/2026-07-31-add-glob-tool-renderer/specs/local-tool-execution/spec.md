## ADDED Requirements

### Requirement: glob result display metadata
系统 SHALL 在 `glob` 成功完成文件发现时，把 handler 已保留的路径事实附加为结构化、可持久化的 display metadata。metadata SHALL 包含按 handler 返回顺序保存的文件路径数组，并 SHALL 只服务终端投影和会话重放，不得改变 provider-visible result 文本、搜索语义或返回上限。

#### Scenario: 成功发现文件时保留有序路径
- **WHEN** ripgrep 返回一个或多个合法文件路径且搜索成功
- **THEN** `glob` result details SHALL 包含 kind 为 `glob` 的 display metadata
- **THEN** metadata paths SHALL 按 handler 接收和返回的顺序保存原始路径字符串

#### Scenario: 无匹配成功结果包含空 metadata
- **WHEN** ripgrep 完成文件发现但没有找到匹配路径
- **THEN** result details SHALL 包含空 paths 数组的合法 glob display metadata
- **THEN** provider-visible result 文本 SHALL 继续表达没有文件匹配

#### Scenario: 达到路径上限时 metadata 与结构化截断一致
- **WHEN** 匹配路径数量超过内置返回上限
- **THEN** display metadata SHALL 只包含 handler 实际保留的路径
- **THEN** `details.truncated` SHALL 为 true
- **THEN** result text SHALL 继续保留既有 `has_more` 和收窄搜索提示

#### Scenario: Provider-visible 文本保持兼容
- **WHEN** handler 为成功结果附加 display metadata
- **THEN** result text SHALL 继续使用既有逐行路径列表或无匹配文案
- **THEN** provider adapter 和 agent continuation SHALL NOT 接收 renderer 专用标题、树形连接或 ANSI 样式文本

#### Scenario: 失败结果省略 display metadata
- **WHEN** arguments 校验失败、ripgrep 不可用或文件发现执行失败
- **THEN** handler SHALL 保持现有 `ok: false`、退出状态和简洁失败文本语义
- **THEN** result SHALL NOT 包含 paths display metadata

#### Scenario: Display metadata 随 transcript 持久化
- **WHEN** 成功 `glob` result 被转换为 tool result transcript record 并写入 session journal
- **THEN** display metadata SHALL 与其他 result details 一同保存和恢复
- **THEN** 持久化过程 SHALL NOT 改写路径顺序或 provider-visible result text
