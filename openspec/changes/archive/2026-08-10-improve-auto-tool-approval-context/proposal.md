## Why

当前自动工具审批固定携带最近 10 条 transcript 文本，用户意图可能被 assistant 和工具输出稀释，同时大段工具参数会增加输入成本和审批时延。需要改为以可信用户授权为核心、按工具有界投影待审批动作的单次判断，在提高准确性的同时保留严格 `yes`/`no` 协议和低延迟特征。

## What Changes

- 用当前回合的用户原始提交文本替代展开后的 provider-facing user text作为主要授权依据，避免文件 mention、skill/workflow 指令和会话引用材料被误当成用户授权。
- 对短小、可能依赖指代的当前请求附加一轮有界的前序 user/assistant 上下文；assistant 内容只能帮助解析用户指代，不能独立建立授权。
- 将当前回合中成功的 `ask_user_questions` 用户答案作为可信澄清依据，并排除普通 tool outputs、reasoning 和 provider-private records。
- 为 Bash、`apply_patch`、`edit_file` 和 MCP 调用构造有界、工具专属的 pending action 投影；不能安全截断的超长动作直接回退人工审批。
- 对整个审批输入实施固定字符预算，并为自动审批 provider 请求增加独立短超时；不做模型总结、只读取证、重试或备用模型调用。
- 保持单次无工具 reviewer、`reasoningEffort: none`、严格 `yes`/`no` 输出、`allow_once` 和失败后人工回退语义。
- 增加不含原始用户文本和工具参数的审批时延、输入规模、投影类型及回退原因 debug 摘要。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `automatic-tool-approval`: 将固定最近 10 条记录改为有信任边界和字符预算的用户意图、澄清答案及工具专属动作投影，并定义超长输入与独立超时的人工回退行为。
- `developer-debug-logging`: 为自动审批增加脱敏的时延、输入规模、上下文形态、动作投影和回退原因观测字段。

## Impact

- 主要影响 `src/app/tool-approval/` 和 `src/app/assistant-turn-runner.ts` 的 reviewer 输入、上下文投影、超时及回退流程。
- 可能提取或复用 `src/tools/` 中 Bash 参数解析、patch 路径扫描、edit 参数解析和 MCP 名称解析逻辑，但不改变现有风险分类结果或工具执行语义。
- 更新自动审批与 debug 相关测试；不新增第三方依赖、provider 请求次数、工具调用能力或用户配置项。
- Headless、plan/readonly 拒绝、人工审批和会话授权缓存行为保持不变。
