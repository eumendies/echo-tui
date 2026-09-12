## ADDED Requirements

### Requirement: 只读子 Agent 的并行委派执行
主 Agent runtime SHALL 把同一并行只读段内的多个 `run_subagent` 调用并发执行，当且仅当每个调用目标 subagent 定义的 executionPolicy 为 `readonly_investigation`（内置 explorer 与自定义 readonly 均适用）。general_purpose 目标的 `run_subagent` SHALL 保持独占执行。系统 SHALL NOT 对并行子 Agent 运行数量设置固定上限。并行段 SHALL 维持现有并行只读语义：父 loop 等待全部调用完成后再继续 provider continuation，结果与取消行为与并行只读工具一致。

#### Scenario: 同轮并行委派两个只读 Agent
- **WHEN** 主 provider turn 返回连续的 `parallel_read` 分类段且包含两个目标为 readonly executionPolicy 的 `run_subagent` 调用
- **THEN** 两个子 Agent loop SHALL 同时启动并并发执行
- **THEN** 父 loop SHALL 等待两个子运行全部结束后再进入下一 provider turn

#### Scenario: 并行段中的独占调用保持屏障
- **WHEN** 同轮工具调用序列中 readonly `run_subagent` 与 `exclusive` 分类调用交替出现
- **THEN** `exclusive` 调用 SHALL 作为屏障，前后只读段分别调度
- **THEN** general_purpose 委派 SHALL NOT 与任何其他调用重叠执行

#### Scenario: 父级取消传播到全部并行子运行
- **WHEN** 父 assistant turn 在并行子运行期间被取消
- **THEN** 所有正在运行的子 Agent SHALL 接收到取消信号
- **THEN** 每个子运行 SHALL 以 cancelled 终态收尾并产生各自的工具结果

### Requirement: 并行分组的渲染事实记录
主 loop 在调度包含两个及以上 `run_subagent` 调用的并行只读段时，SHALL 通过工具执行选项向委派端口传递分组规模，端口 SHALL 把 `parallelSize` 写入每个子运行的 start record。单委派或不含 `run_subagent` 的并行段 SHALL NOT 写入 `parallelSize`。`parallelSize` SHALL 随子 Agent start record 持久化，供实时投影、快照重绘与会话重放读取。

#### Scenario: 并行分组写入 parallelSize
- **WHEN** 一个并行只读段包含两个 `run_subagent` 调用并开始执行
- **THEN** 每个子运行的 start record SHALL 携带 `parallelSize` 为 2

#### Scenario: 单委派不携带并行标记
- **WHEN** 一个并行只读段仅包含一个 `run_subagent` 调用与若干观察工具
- **THEN** 该子运行的 start record SHALL NOT 携带 `parallelSize`

## REMOVED Requirements

### Requirement: 子 Agent 委派预算与父级取消
**Reason**: 每父 run 四次委派预算已在代码中移除（de71c23），spec 与实现长期漂移；并行委派能力建立在无固定预算的现状之上。父级取消语义由"只读子 Agent 的并行委派执行"与其他既有取消要求继续覆盖。
**Migration**: 无需迁移；委派频次交由模型自律与既有审批边界约束。
