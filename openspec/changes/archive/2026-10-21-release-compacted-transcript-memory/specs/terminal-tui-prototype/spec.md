## ADDED Requirements

### Requirement: 压缩会话仅重绘活跃 transcript
系统 SHALL 在已压缩主会话的破坏性重绘中展示压缩历史提示及当前活跃 transcript，而不重新加载或重放被摘要覆盖的原始前缀。提示 SHALL 表达较早历史已压缩、完整记录保存在会话文件中，SHALL 避免同一提示重复展示，且 SHALL NOT 因重绘额外追加 transcript record。当前 banner、in-flight 内容、footer 和光标恢复规则 SHALL 保持不变。本要求 SHALL 同样适用于恢复 session、主题切换及退出 BTW/子 Agent 视图后重建主会话快照。

#### Scenario: 压缩成功不主动清除 scrollback
- **WHEN** compaction 成功且当前没有其他破坏性重绘触发条件
- **THEN** 系统 SHALL NOT 仅为了释放内存清空 screen 或 scrollback
- **THEN** 已输出的旧消息 SHALL 留在终端现有历史中，新记录继续增量追加

#### Scenario: Resize 后只重绘提示与活跃记录
- **WHEN** 已压缩主会话因终端尺寸变化执行破坏性重绘
- **THEN** transcript projection SHALL 包含当前压缩历史提示及边界之后的可见记录
- **THEN** 系统 SHALL NOT 为该次重绘读取 journal 中已压缩的原文
- **THEN** pending、composer、status line 和光标 SHALL 遵循现有恢复规则

#### Scenario: 恢复和主题切换沿用活跃投影
- **WHEN** 系统恢复已压缩 session 或为该 session 切换主题并重绘
- **THEN** 主会话 SHALL 只按当前主题投影压缩历史提示与活跃记录
- **THEN** 该展示提示 SHALL NOT 产生新的持久化 transcript record

#### Scenario: 退出历史视图不重新装入旧前缀
- **WHEN** 用户退出 BTW 或历史子 Agent 回看视图并返回已压缩主会话
- **THEN** 主会话快照 SHALL 恢复压缩历史提示与活跃记录
- **THEN** 主 renderer SHALL NOT 为重建旧 run 身份而长期持有已释放 transcript 原始对象

#### Scenario: 无压缩会话保持原有重绘
- **WHEN** 主会话没有 compaction 状态并执行重绘
- **THEN** 系统 SHALL 按现有规则投影全部当前 transcript
- **THEN** 系统 SHALL NOT 显示压缩历史提示
