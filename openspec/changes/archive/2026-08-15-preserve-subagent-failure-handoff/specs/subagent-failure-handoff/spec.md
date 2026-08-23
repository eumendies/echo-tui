## ADDED Requirements

### Requirement: 非取消失败返回部分工作交接
已启动的子 Agent因provider、配置或内部执行错误失败且父turn未取消时，系统 SHALL 生成 `ok: false` 的外层 `run_subagent` tool result，并 SHALL 在结果正文中提供基于当前子运行事实的 failure handoff。交接 SHALL包含安全归一化失败原因，并在存在可恢复进展时包含稳定输出、已完成工具工作或未完成assistant草稿。交接 SHALL由本地确定性逻辑生成，SHALL NOT为总结失败过程发起额外provider请求。

#### Scenario: 已有稳定调查结果后失败
- **WHEN** 子 Agent已发布一个或多个稳定assistant、reasoning summary或内部tool result后发生非取消错误
- **THEN** 外层`run_subagent` result SHALL保持`ok: false`
- **THEN** result正文 SHALL包含失败原因和可供主Agent继续工作的稳定进展
- **THEN** 主Agent后续provider continuation SHALL通过该外层result取得交接，而不是直接取得`subagent` role records

#### Scenario: 尚无可恢复进展时失败
- **WHEN** 子 Agent启动后在产生稳定输出、完成工具或非空assistant draft前发生非取消错误
- **THEN** 系统 SHALL返回包含安全失败原因的简短失败交接
- **THEN** 交接 SHALL明确没有记录到可恢复进展，且 SHALL NOT伪造调查结论或工具工作

#### Scenario: 交接不依赖App观察回调
- **WHEN** headless运行中的子 Agent产生稳定内部过程后发生非取消错误
- **AND** 当前入口没有TUI transcript或activity callback
- **THEN** 外层失败结果 SHALL仍包含与相同运行事实一致的failure handoff

### Requirement: 交接区分稳定、不完整和状态不明事实
系统 SHALL把已稳定提交的assistant segment和匹配tool result的内部调用标为稳定进展。当前provider segment中尚未正常完成的非空assistant streaming draft MAY进入交接，但 SHALL明确标为不完整且未经验证；完整reasoning summary SHALL仅在没有稳定assistant segment和未完成assistant draft时作为最近稳定说明兜底，raw reasoning draft SHALL NOT进入交接。存在tool call但没有匹配tool result时，系统 SHALL把调用标为结果状态不明，SHALL NOT断言其未执行、成功或失败。

#### Scenario: 最终回答streaming期间失败
- **WHEN** 子 Agent当前provider segment已经产生非空assistant draft但尚未形成稳定assistant event时失败
- **THEN** failure handoff SHALL保留该draft的有界内容并标记为不完整且未经验证
- **THEN** 系统 SHALL NOT把该draft描述为子 Agent最终回答或稳定结论

#### Scenario: 已稳定segment不重复标为草稿
- **WHEN** 子 Agent将一个assistant segment稳定提交后进入后续provider continuation并失败
- **THEN** 已提交segment SHALL只作为稳定输出参与交接
- **THEN** 系统 SHALL NOT把上一segment的旧draft再次投影为当前未完成草稿

#### Scenario: 工具调用缺少结果
- **WHEN** 已发布的内部tool call在子运行失败前没有匹配call id的tool result
- **THEN** handoff SHALL把该调用列为结果状态不明
- **THEN** 对可能修改文件、执行Bash或调用MCP的状态不明调用，handoff SHALL提示主Agent先验证副作用再决定是否重复

#### Scenario: 工具返回失败结果
- **WHEN** 内部tool call存在匹配且`ok: false`的tool result
- **THEN** handoff SHALL把该结果作为已完成的稳定失败事实
- **THEN** 系统 SHALL NOT仅因`ok: false`把该调用误列为结果状态不明

#### Scenario: Assistant进展优先于reasoning summary
- **WHEN** 失败运行同时包含稳定assistant segment或未完成assistant draft以及完整reasoning summary
- **THEN** handoff SHALL投影assistant进展并省略reasoning summary
- **WHEN** 失败运行没有任何assistant segment或draft但存在完整reasoning summary
- **THEN** handoff MAY把最近的有界reasoning summary作为稳定说明兜底

### Requirement: Failure handoff 保持有界且可判读
系统 SHALL对failure handoff应用固定的全局内容预算和动态字段局部预算。无论中间过程大小，交接 SHALL优先保留失败原因、工具完成与状态不明计数、潜在副作用事实和截断说明；稳定assistant输出、不完整draft、兜底reasoning summary、工具参数与工具结果 SHALL按确定性优先级有界投影。Handoff SHALL NOT重复外层调用已经提供的Agent名称、失败状态或内部runId。任何被省略的过程项或正文 SHALL通过省略数量、截断标记或等价事实显式表达。

#### Scenario: 单个工具输出超过预算
- **WHEN** 一个已完成内部工具的result正文超过交接的局部或总预算
- **THEN** handoff SHALL只包含确定性截取的有界摘要或头尾片段
- **THEN** handoff SHALL保留工具名称、完成状态和输出已截断事实

#### Scenario: 工具数量超过过程索引预算
- **WHEN** 子运行包含的内部工具数量无法全部放入交接预算
- **THEN** handoff SHALL保留总数、完成/失败/状态不明计数和预算允许的有序索引
- **THEN** handoff SHALL明确仍有多少工具过程被省略

#### Scenario: 文件编辑结果使用结构化摘要
- **WHEN** 已完成的`apply_patch`或`edit_file`结果包含结构化文件display metadata
- **THEN** handoff SHALL优先投影有界文件路径及added、updated或deleted事实
- **THEN** handoff SHALL NOT为了表达已完成修改而复制完整diff

#### Scenario: 附件不复制二进制正文
- **WHEN** 已完成工具结果包含图片附件
- **THEN** handoff MAY包含有界路径、媒体类型和大小摘要
- **THEN** handoff SHALL NOT复制附件base64数据

#### Scenario: 不暴露无消费方的运行身份
- **WHEN** 系统为失败子运行生成provider-facing handoff
- **THEN** handoff SHALL NOT包含内部runId
- **THEN** handoff SHALL NOT重复独立的Agent或Status字段

### Requirement: 交接不改变成功、取消和本地过程隔离
成功子运行 SHALL继续只把最终回答作为成功的外层tool result正文。父级取消或用户中断 SHALL继续沿用现有取消语义，SHALL NOT转换为普通失败交接。Failure handoff SHALL只通过外层tool result进入主provider上下文；本地`subagent` records、provider-private reasoning和raw reasoning draft SHALL继续被过滤。

#### Scenario: 子 Agent正常成功
- **WHEN** 子 Agent正常产生最终回答并完成
- **THEN** 外层`run_subagent` result SHALL标记成功并只返回最终回答
- **THEN** 系统 SHALL NOT在成功正文前后附加failure handoff章节

#### Scenario: 父级取消正在运行的子 Agent
- **WHEN** 父turn取消信号终止正在运行的子 Agent
- **THEN** 系统 SHALL按既有取消流程结束父turn
- **THEN** 系统 SHALL NOT创建供主provider继续消费的普通失败handoff

#### Scenario: 主provider构造失败后的continuation
- **WHEN** transcript包含子 Agent本地过程records和包含failure handoff的成对外层`run_subagent` call/result
- **THEN** 主provider input SHALL包含外层call/result及handoff正文
- **THEN** 主provider input SHALL NOT包含`subagent` role records、内部tool call id或provider-private reasoning records
