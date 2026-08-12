## Why

主 Agent 目前只能亲自完成代码检索、证据收集和局部分析，复杂任务会因此挤占主上下文并让用户在长时间工具执行期间缺少可见进展。引入受控只读子 Agent，可以把边界明确的调查任务隔离执行，同时保留人工审批、安全审计、会话恢复和终端可观察性。

## What Changes

- 新增主 Agent 可调用的 `run_subagent` 工具，第一版提供内置 `explorer` 子 Agent，并限制为单层、同步委派。
- 每次委派通过 runtime factory 创建新的 subagent loop runtime 实例；主 Agent runtime 与子 Agent runtime 作为同一 runtime 包中的两个独立业务入口，各自拥有 loop、hook、callback 和工具执行编排，只共享无角色语义的 provider context 等纯函数。子 runtime 固定独立 system prompt、父 run 上下文快照和真实裁剪后的工具目录；默认只暴露文件检索、只读 Web、skill 加载和 Bash 等观察工具，不暴露文件编辑、用户提问、Todo、MCP 或再次委派能力。
- 对子 Agent Bash 使用固定的 fail-closed 策略：严格只读 allowlist 中的命令直接执行，其他命令在交互环境进入与主 Agent 相同的审批流程并共享会话授权缓存，在 headless 环境直接拒绝；该策略不继承父级 interaction mode。
- 将子 Agent 的开始、可见推理摘要、assistant 段、内部工具调用/结果以及结束状态作为本地结构化 transcript 事实增量持久化；这些过程记录不进入主 Agent provider 上下文，只有外层 `run_subagent` tool result 返回主 Agent。
- 新增子 Agent rail 投影：外层连续 rail 表达一次子 Agent 运行，内部嵌套现有工具调用/结果 renderer；活动尾部在 footer 实时刷新，恢复与 resize 后可从 transcript 重绘。
- 将父 turn 取消信号传播到子 Agent 和其 Bash 进程，并隔离已结束或取消运行的迟到 callback。

## Capabilities

### New Capabilities
- `readonly-subagent-delegation`: 定义受控只读子 Agent 的委派协议、独立 prompt 与工具边界、Bash 人工升级、运行预算、结果回传和取消语义。
- `subagent-transcript-rendering`: 定义子 Agent 工作过程的本地 transcript 记录、provider 隔离、journal 恢复、嵌套 rail 实时投影和窄终端降级行为。

### Modified Capabilities

无。

## Impact

- 影响 `src/agent/` 的主/子 runtime 包、provider context 构造、conversation kind、运行预算和嵌套 agent callback 桥接。
- 影响 `src/tools/` 的工具 registry 投影、只读 Bash 判定和 `run_subagent` schema/结果处理。
- 影响 `src/app/` 的 turn 状态、人工审批来源、子 Agent 活动投影、取消与迟到 callback 隔离。
- 影响 `src/types/transcript.ts`、transcript journal 校验、会话预览、上下文压缩和各 provider transcript converter。
- 影响 `src/render/` 的 transcript block 分组、通用 rail primitive、嵌套工具投影、footer pending 和 resize replay。
- 需要增加 agent runtime、审批、持久化、provider 隔离、恢复和纯 renderer 测试；不引入第三方依赖、alternate screen 或新的构建系统。
