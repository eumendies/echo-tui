## ADDED Requirements

### Requirement: Footer tool pending 与 working 状态投影
系统 SHALL 在 footer 临时区域支持工具调用 pending preview 与本轮 working 状态投影。pending preview SHALL 显示在 footer 上部；working spinner SHALL 显示在 pending preview 下方、divider 上方，并紧贴 divider。

#### Scenario: tool call pending preview 显示在 footer
- **WHEN** app 存在未完成的 tool call pending 状态
- **THEN** footer SHALL 显示该工具调用的用户可读 preview
- **THEN** preview SHALL 使用与正式 tool call 记录兼容的工具名称和参数投影
- **THEN** preview SHALL 随 footer redraw 更新，而不是进入 transcript/scrollback 区域

#### Scenario: working spinner 从首字后持续到本轮结束
- **WHEN** 本轮 assistant 首个文本增量到达
- **THEN** footer SHALL 开始显示 working spinner 和本轮已耗时
- **WHEN** 本轮继续 streaming、执行工具或等待 continuation 响应
- **THEN** working spinner SHALL 持续显示并更新帧与耗时
- **WHEN** 本轮 complete 或 fail
- **THEN** footer SHALL 停止显示 working spinner

#### Scenario: working spinner 紧贴 divider 上方
- **WHEN** footer 同时存在 pending preview、working 状态和 composer 输入区
- **THEN** footer SHALL 按 pending preview、working line、divider、composer surface 的顺序渲染
- **THEN** working line SHALL 位于 divider 正上方
- **THEN** pending preview SHALL NOT 插入 working line 与 divider 之间

### Requirement: Tool call prefix 状态着色
系统 SHALL 在终端可见投影中根据相邻工具结果状态为 tool call 行的 `◆` prefix 着色。该着色 SHALL 只影响 render 层输出，不改变 transcript record 中保存的原始 tool call 或 tool result 文本。

#### Scenario: 成功工具调用使用成功 prefix 样式
- **WHEN** render 层投影相邻的 tool call record 和 `ok: true` tool result record
- **THEN** tool call 行的 `◆` prefix SHALL 使用成功样式
- **THEN** tool result 输出文本 SHALL 继续按现有截断和换行规则显示

#### Scenario: 失败工具调用使用失败 prefix 样式
- **WHEN** render 层投影相邻的 tool call record 和 `ok: false` tool result record
- **THEN** tool call 行的 `◆` prefix SHALL 使用失败样式
- **THEN** tool result 输出文本 SHALL 继续保留可读错误内容

#### Scenario: 历史或缺少状态的工具调用安全降级
- **WHEN** render 层投影缺少相邻 result 状态的历史 tool call record
- **THEN** renderer SHALL 使用既有中性样式显示该 call
- **THEN** renderer SHALL NOT 抛出错误或隐藏该记录
