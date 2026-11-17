## MODIFIED Requirements

### Requirement: 交接不改变成功、取消和本地过程隔离
成功子运行 SHALL继续把最终回答作为成功的外层tool result正文；worktree Worker SHALL 另外附加系统生成的工作区交接（路径、基线、执行目录与未集成事实），其他子 Agent SHALL 保持只返回最终回答。工作区交接 SHALL 与 failure handoff 分开表达，不得把工作区存在当作验证通过的结论。父级取消或用户中断 SHALL继续沿用现有取消语义，SHALL NOT转换为普通失败交接。Failure handoff SHALL只通过外层tool result进入主provider上下文；本地`subagent` records、provider-private reasoning和raw reasoning draft SHALL继续被过滤。

#### Scenario: 子 Agent正常成功
- **WHEN** 子 Agent正常产生最终回答并完成
- **THEN** 外层`run_subagent` result SHALL标记成功并返回最终回答；仅 worktree Worker SHALL 额外包含受管工作区交接
- **THEN** 系统 SHALL NOT在成功正文前后附加failure handoff章节

#### Scenario: 父级取消正在运行的子 Agent
- **WHEN** 父turn取消信号终止正在运行的子 Agent
- **THEN** 系统 SHALL按既有取消流程结束父turn
- **THEN** 系统 SHALL NOT创建供主provider继续消费的普通失败handoff

#### Scenario: 主provider构造失败后的continuation
- **WHEN** transcript包含子 Agent本地过程records和包含failure handoff的成对外层`run_subagent` call/result
- **THEN** 主provider input SHALL包含外层call/result及handoff正文
- **THEN** 主provider input SHALL NOT包含`subagent` role records、内部tool call id或provider-private reasoning records

#### Scenario: worktree 失败仍能交接实际文件
- **WHEN** worktree Worker 在产生文件修改后发生非取消错误
- **THEN** 外层结果 SHALL 保持失败，包含原 failure handoff 与可定位的保留工作区路径
- **THEN** 系统 SHALL NOT 为生成工作区摘要再请求模型，也 SHALL NOT 把部分成果标为已集成

#### Scenario: 父级取消只保留本地恢复信息
- **WHEN** 父 turn 取消正在运行的 worktree Worker
- **THEN** 工作区状态和路径 SHALL 被保存在受管登记及可用本地稳定记录中
- **THEN** 系统 SHALL NOT 为此恢复父 provider continuation 或伪造普通失败 handoff
