## MODIFIED Requirements

### Requirement: footer 布局
系统 SHALL 渲染底部 footer。footer 由可选 pending preview 和当前输入 surface 组成：普通输入态的 surface 为 1 到 N 行 composer 和固定 1 行 hint；help overlay 态的 surface 为覆盖在 composer 区域的帮助内容和退出提示。assistant streaming pending preview SHALL 使用按 terminal rows 动态预算的 Markdown-aware 尾部预览，避免长输出时 footer 高度无限增长。

#### Scenario: footer 显示 composer 和 hint
- **WHEN** 没有 pending assistant response，且 help overlay 未激活
- **THEN** footer SHALL 渲染 composer，并在其后渲染恰好 1 行 hint

#### Scenario: assistant 工作期间显示 pending preview
- **WHEN** assistant 正在 thinking 或 streaming，且 help overlay 未激活
- **THEN** footer SHALL 在 composer 和 hint 上方包含 pending preview

#### Scenario: streaming pending preview 保持有限高度
- **WHEN** assistant 正在 streaming 长 Markdown draft
- **THEN** footer SHALL 在 Markdown-aware terminal projection 后折叠 pending preview 的头部并显示尾部内容
- **THEN** footer SHALL NOT 因完整 draft 变长而把 pending preview 无限追加到 terminal scrollback

#### Scenario: composer 支持多行显示
- **WHEN** help overlay 未激活，且 composer 内容包含插入的换行，或因终端宽度发生 wrap
- **THEN** footer SHALL 为 composer 分配足够的行数，再渲染 hint 行

#### Scenario: help overlay 替换普通 composer surface
- **WHEN** help overlay 处于活跃状态
- **THEN** footer SHALL 使用 help overlay 内容替换普通 composer 与默认 hint 的显示区域
- **THEN** 帮助内容 SHALL 保持在 footer 临时区域内，而不是写入 transcript 历史区域

### Requirement: streaming pending preview 高度受限
系统 SHALL 在 assistant streaming 期间按当前 terminal rows 动态限制 pending preview 高度。长 draft 的 pending preview SHALL 先生成 Markdown-aware terminal projection，再给 divider、composer/hint 或 command surface 以及安全边距预留空间后，折叠头部并显示尾部内容，避免 footer 高度随完整 draft 无限增长并进入 terminal scrollback。

#### Scenario: 短 streaming draft 正常显示
- **WHEN** assistant streaming draft 按当前终端宽度投影后的行数不超过 preview 高度限制
- **THEN** footer pending preview SHALL 显示完整 Markdown-aware projection
- **THEN** footer pending preview SHALL 保持 streaming 前缀样式

#### Scenario: 长 streaming draft 折叠头部
- **WHEN** assistant streaming draft 按当前终端宽度投影后的行数超过 preview 高度限制
- **THEN** footer pending preview SHALL 显示一行折叠提示
- **THEN** footer pending preview SHALL 只显示最新尾部内容
- **THEN** footer pending preview 的总行数 SHALL 不超过根据当前 terminal rows 与 footer 输入区高度计算出的动态预算

#### Scenario: streaming preview 折叠不改变最终 transcript
- **WHEN** assistant streaming draft 在 pending preview 中被折叠显示
- **THEN** 系统 SHALL 继续在内存中保留完整 assistant draft
- **THEN** assistant 完成后追加的 assistant transcript record SHALL 包含完整 draft，而不是折叠后的 preview 文本

### Requirement: 真实 assistant 生命周期
系统 SHALL 支持真实 assistant response 生命周期：用户普通消息提交后进入 thinking 状态，随后以真实模型服务返回的文本增量更新 Markdown-aware streaming preview，并在成功完成后提交最终 assistant block。fake assistant MAY 作为测试或显式开发注入实现，但 CLI 默认普通对话 SHALL 使用真实 LLM adapter，且 agent SHALL 接收当前 transcript records 作为多轮上下文输入。

#### Scenario: thinking 状态先于 streaming
- **WHEN** 用户普通消息被提交并启动 assistant response
- **THEN** footer pending preview SHALL 在首个真实文本增量到达前显示 assistant thinking 状态

#### Scenario: streaming 展示真实文本增量
- **WHEN** 真实 LLM adapter 接收到文本增量
- **THEN** footer pending preview SHALL 按 adapter 提供的完整 draft 更新 streaming 文本
- **THEN** streaming 文本 SHALL 来自真实模型服务，而不是固定回显用户原始提交内容
- **THEN** streaming 文本 SHALL 通过容错 Markdown-aware terminal projection 显示

#### Scenario: 完成后提交 assistant transcript
- **WHEN** 真实 LLM adapter 成功完成响应
- **THEN** pending preview SHALL 被清空，并且完成后的 assistant 消息 SHALL 被追加到 transcript
- **THEN** 完成后的 assistant 消息 SHALL 通过 Markdown-aware terminal projection 显示

#### Scenario: 失败后释放响应锁
- **WHEN** 真实 LLM adapter 在 thinking 或 streaming 期间失败
- **THEN** pending preview SHALL 被清空
- **THEN** assistant response lock SHALL 被释放
- **THEN** 系统 SHALL 追加一条本地 `error` transcript record 作为可见反馈

#### Scenario: 测试注入 fake agent 不改变 CLI 默认行为
- **WHEN** 测试通过 `createApp(options).runAgent` 注入 fake 或 stub agent
- **THEN** app SHALL 按相同 callbacks contract 处理 thinking、streaming 和 completion
- **THEN** CLI 默认普通对话行为 SHALL 由真实 LLM adapter 提供
- **THEN** 注入的 fake 或 stub agent SHALL 接收当前 transcript records，而不是单个用户文本字符串

### Requirement: transcript 视觉标记
系统 SHALL 使用轻量符号和克制颜色区分 transcript 中的用户消息、assistant 消息、本地 error 消息和 pending assistant，而不是在 transcript 中显示 `user:`、`assistant:` 或 `error:` 文本标签。用户消息的整行背景 SHALL 在渲染投影阶段按当前终端宽度计算。assistant 消息内容 SHALL 支持 Markdown-aware terminal projection，但 role 视觉标记 SHALL 继续由 transcript renderer 控制。

#### Scenario: 用户消息使用轻量前缀
- **WHEN** 用户消息被追加到 transcript
- **THEN** 该消息 SHALL 使用与 composer prompt 一致的 `>` 作为前缀，并使用覆盖整条消息行的灰色背景与 assistant 消息区分

#### Scenario: 用户消息 resize 后背景覆盖当前宽度
- **WHEN** 用户消息已经追加到 transcript 且终端随后变窄或变宽
- **THEN** 用户消息 SHALL 基于当前终端宽度重新渲染，灰色背景 SHALL 覆盖重新 wrap 后每一行的当前渲染宽度

#### Scenario: assistant 完成消息使用独立前缀
- **WHEN** assistant 消息完成并追加到 transcript
- **THEN** 该消息 SHALL 使用 `◆` 或等价符号作为前缀，并使用与用户消息不同的视觉样式
- **THEN** 该消息内容 SHALL 按 Markdown-aware terminal projection 显示

#### Scenario: error 消息使用独立可见投影
- **WHEN** 本地 error record 被追加或恢复到 transcript
- **THEN** 该消息 SHALL 使用区别于 user 和 assistant 的轻量可见样式
- **THEN** 该消息 SHALL NOT 显示为 `assistant` 回复

#### Scenario: transcript 不显示文字角色标签
- **WHEN** user、assistant 或 error 消息被渲染为 transcript block
- **THEN** transcript SHALL NOT 显示 `user:`、`assistant:` 或 `error:` 作为消息前缀
