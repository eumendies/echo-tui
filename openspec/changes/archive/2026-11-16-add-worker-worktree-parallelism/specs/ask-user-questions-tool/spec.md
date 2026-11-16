## ADDED Requirements

### Requirement: 并行子运行用户问题按来源排队
interactive 父运行收到多个有效子运行的用户问题时，系统 SHALL 按到达顺序排队，每次只展示一个 choice surface，并为每项保留父 turn、子 run 和 tool call 关联。新请求 SHALL NOT 替换或取消当前请求。提交或 Esc 取消当前请求后 SHALL 激活下一个仍有效的请求，结果 SHALL 仅返回对应调用。父 turn 中断或退出 SHALL 一次结算当前与排队请求，过期来源 SHALL NOT 重新打开 surface。Headless SHALL 继续立即返回取消，不进入等待队列。

#### Scenario: 两个 Worker 同时提问
- **WHEN** Worker A 的问题已展示且同一父 turn 的 Worker B 提交有效问题
- **THEN** A 的草稿和 surface SHALL 保持不变，B SHALL 排队等待
- **THEN** A 的答案 SHALL 仅返回 A 的内部 call，之后展示 B 的问题并标明 B 来源

#### Scenario: Esc 只取消队首请求
- **WHEN** 当前问题 surface 活跃且其后有排队问题，用户按 Esc
- **THEN** 系统 SHALL 只为当前请求生成 cancelled result 并激活下一有效请求
- **THEN** 同一次 Esc SHALL NOT 中断父 turn 或取消其他排队请求

#### Scenario: 父级取消清空等待者
- **WHEN** 父 turn 中断或应用退出时存在活跃和排队的 Worker 问题
- **THEN** 系统 SHALL 结算全部请求并清空 surface 与队列
- **THEN** 旧 run 的迟到请求或回答 SHALL NOT 影响下一轮运行

#### Scenario: Headless 不等待队列
- **WHEN** 多个 headless Worker 调用 ask_user_questions
- **THEN** 每个调用 SHALL 立即得到自己的 cancelled result
- **THEN** 系统 SHALL NOT 创建可交互等待队列或读取 stdin
