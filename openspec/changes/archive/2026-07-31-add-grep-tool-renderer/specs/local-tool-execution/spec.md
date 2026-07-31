## ADDED Requirements

### Requirement: grep result display metadata
系统 SHALL 在 `grep` 成功完成搜索时，把 handler 已解析的匹配事实附加为结构化、可持久化的 display metadata。每个 metadata 匹配项 SHALL 包含文件路径、1-based 行号、1-based 列号和原始命中行文本；该 metadata SHALL 只服务终端投影和会话重放，不得改变 provider-visible result 文本、搜索语义或返回上限。

#### Scenario: 成功搜索保留有序匹配 metadata
- **WHEN** ripgrep 返回一个或多个合法 match 事件且搜索成功
- **THEN** `grep` result details SHALL 包含 kind 为 `grep` 的 display metadata
- **THEN** metadata matches SHALL 按 handler 接收和返回匹配的顺序保存 path、line、column 和 text
- **THEN** metadata 的 line 和 column SHALL 保持现有 result 文本使用的 1-based 语义

#### Scenario: 无匹配成功结果包含空 metadata
- **WHEN** ripgrep 以无匹配状态完成且 handler 返回 `ok: true`
- **THEN** result details SHALL 包含空 matches 数组的合法 grep display metadata
- **THEN** provider-visible result 文本 SHALL 继续表达没有找到匹配

#### Scenario: 达到匹配上限时 metadata 与结构化截断一致
- **WHEN** 匹配数量超过内置返回上限
- **THEN** display metadata SHALL 只包含 handler 实际保留的匹配项
- **THEN** `details.truncated` SHALL 为 true
- **THEN** result text SHALL 继续保留既有 `has_more` 和收窄搜索提示

#### Scenario: Provider-visible 文本保持兼容
- **WHEN** handler 为成功结果附加 display metadata
- **THEN** result text SHALL 继续使用既有紧凑匹配列表或无匹配文案
- **THEN** provider adapter 和 agent continuation SHALL NOT 接收 renderer 专用标题、树形连接、ANSI 样式或语法高亮文本

#### Scenario: 失败结果不要求 display metadata
- **WHEN** arguments 校验失败、ripgrep 不可用、regex 无效或搜索执行失败
- **THEN** handler SHALL 保持现有 `ok: false`、退出状态和简洁失败文本语义
- **THEN** result SHALL NOT require matches display metadata

#### Scenario: Display metadata 随 transcript 持久化
- **WHEN** 成功 `grep` result 被转换为 tool result transcript record 并写入 session journal
- **THEN** display metadata SHALL 与其他 result details 一同保存和恢复
- **THEN** 持久化过程 SHALL NOT 改写 metadata 匹配顺序或 provider-visible result text
