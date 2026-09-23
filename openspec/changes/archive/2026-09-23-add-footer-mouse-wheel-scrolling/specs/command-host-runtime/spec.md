## MODIFIED Requirements

### Requirement: CommandRuntime 转发已声明的语义 pointer 输入
系统 SHALL 允许 `CommandHandler` 为当前 command session 可选声明语义 pointer 点击/hover 与右侧预览/详情滚轮处理能力。`CommandRuntime` SHALL 保持 command session 所有权，并将已由 footer pointer 层校验 identity、frame 和命中的结构化点击 target 连同 hover 或 activate 阶段，或右侧滚轮方向交给当前显式支持相应输入的 handler；handler SHALL 继续仅通过 `CommandHost` 执行业务动作。runtime SHALL 在 handler 更新 session 后复用既有渲染生命周期，且 SHALL NOT 为模型选择、会话恢复、消息复制、diff 滚动新增 command-specific effect interpreter。

#### Scenario: runtime 将命中转发给当前 handler
- **WHEN** active command session 的 handler 已声明 pointer 点击/hover 处理能力
- **AND** 当前 frame 的 hit region identity 与 command session consumer 匹配
- **THEN** runtime SHALL 将该 region 的结构化 target 和 hover 或 activate 阶段转发给该 handler
- **THEN** runtime SHALL 保持 active command session 的所有权

#### Scenario: runtime 将右栏滚轮转发给当前 handler
- **WHEN** active command handler 显式声明预览/详情滚轮处理能力
- **AND** 当前 frame 的右栏 wheel region identity 与 command session consumer 匹配
- **THEN** runtime SHALL 将右栏语义与方向转发给 handler 并按实际 session 更新重绘
- **THEN** runtime SHALL NOT 根据 commandName 直接变更预览/详情偏移或领域设置

#### Scenario: handler 未声明 pointer 时不打开协议能力
- **WHEN** active command session 的 handler 未声明 pointer 点击/hover 或右侧滚轮处理能力
- **THEN** runtime SHALL 不将该 session 作为 pointer-capable consumer 暴露给 resolver
- **THEN** runtime SHALL 继续只按既有路径转发键盘输入事件

#### Scenario: handler 仅支持一种 pointer 操作
- **WHEN** active handler 仅声明点击/hover 或仅声明右栏滚轮处理能力
- **THEN** runtime SHALL 只分发已声明的输入
- **THEN** 未声明的输入 SHALL NOT 因另一种区域存在而执行

#### Scenario: runtime 不解释 command pointer 业务 action
- **WHEN** pointer target 命中可选择项，或滚轮命中右侧预览/详情
- **THEN** 对应 handler SHALL 通过 `CommandHost` 或 session update 执行既有领域行为
- **THEN** runtime SHALL NOT 根据 commandName、target index 或 surface kind 执行模型保存、会话恢复、剪贴板写入或 diff 滚动规则
