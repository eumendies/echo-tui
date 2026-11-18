## ADDED Requirements

### Requirement: 分叉会话继承源会话标题
系统 SHALL 在 `/fork` 创建新 session 时，把源 session 当前的标题写入新 session 的 index 条目。该继承 SHALL 与分叉时写入的消息数量、时间戳和 journal 指纹一起原子提交。

新 session SHALL NOT 因继承动作触发标题生成请求；继承得到的标题 SHALL 与源 session 标题保持一致，直到该 session 被后续机制显式改写。

#### Scenario: 分叉后继承标题
- **GIVEN** 当前 session 的 index 标题为任意非空字符串
- **WHEN** `/fork` 成功创建新 session
- **THEN** 新 session 的 index 标题 SHALL 等于源 session 的标题
- **THEN** 系统 SHALL NOT 触发标题生成请求

#### Scenario: 源会话标题为派生值
- **GIVEN** 当前 session 尚未生成过标题，index 标题为从首条用户消息派生的值
- **WHEN** `/fork` 成功创建新 session
- **THEN** 新 session 的 index 标题 SHALL 等于该派生值

#### Scenario: 分叉失败不写标题
- **GIVEN** 当前会话为空或新 journal 创建失败
- **WHEN** 用户提交 `/fork`
- **THEN** 系统 SHALL NOT 创建带标题的新 index 条目
- **THEN** 源 session 的标题 SHALL 保持不变
