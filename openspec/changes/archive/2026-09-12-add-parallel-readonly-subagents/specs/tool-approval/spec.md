## ADDED Requirements

### Requirement: 人工授权请求 FIFO 排队
人工授权 surface 同时只展示一个请求；新授权请求在存在活跃请求时 SHALL 进入 FIFO 队列等待，而不是抢占式 deny 活跃请求。活跃请求以任意决策结束后，系统 SHALL 按队列顺序提升下一个请求并打开 surface。会话级授权缓存与自动审批路径 SHALL 保持既有行为；自动审批拒绝后的回退 SHALL 进入同一队列。父 assistant turn abort 时，活跃与排队请求 SHALL 统一以 interrupted 决议收尾，不留下悬挂等待。

#### Scenario: 并行子 Agent 审批逐个处理
- **WHEN** 两个并行子 Agent 同时发起人工授权请求
- **THEN** 第一个 SHALL 打开授权 surface，第二个 SHALL 进入队列等待
- **THEN** 第一个请求决议后 SHALL NOT 被 deny，第二个 SHALL 随即打开

#### Scenario: 单请求行为保持
- **WHEN** 同一时刻只有一个授权请求
- **THEN** 请求 SHALL 直接打开 surface，行为与现状一致

#### Scenario: 父 turn 中断清算排队请求
- **WHEN** 父 assistant turn 在存在活跃与排队授权请求时被中断
- **THEN** 所有活跃与排队请求 SHALL 以 interrupted 决议收尾
