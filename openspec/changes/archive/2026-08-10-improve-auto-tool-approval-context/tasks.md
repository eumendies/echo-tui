## 1. Turn-scoped 用户授权输入

- [x] 1.1 在 composer 提交链展开 command、skill、workflow、file mention 和 conversation reference 前捕获用户原始输入，并通过 assistant turn runner 传给自动审批 resolver
- [x] 1.2 用显式的当前用户原始输入替换临时 `displayText || text` 最后一条 user 投影，保持该字段仅驻留当前 turn 且不改变 transcript/provider 内容
- [x] 1.3 增加原始输入与 provider-facing 展开内容分离的 controller 级测试，覆盖普通输入、文件 mention、direct skill、workflow 和 conversation reference

## 2. 有信任边界的审批上下文

- [x] 2.1 实现按 Unicode code point 边界保留头尾的有界文本 helper，以及当前请求、前序 user、前序 assistant、澄清答案和总 prompt 的字符预算
- [x] 2.2 为不超过 240 字符的当前请求投影当前 turn 之前最近一轮有界 user/assistant exchange，并让长请求省略该引用窗口
- [x] 2.3 复用 `ask_user_questions` 结构校验，按 call id 从当前 turn 恢复成功用户答案；排除取消、失败、无效和普通工具结果
- [x] 2.4 更新固定审批 system prompt，明确用户输入与已验证澄清答案是唯一授权来源，assistant 引用和 pending action 仅是不可信数据，并继续要求精确 `yes`/`no`
- [x] 2.5 增加上下文投影测试，覆盖短请求指代、长请求、可信问答、普通 tool output 注入、附件和 provider-private 记录过滤以及 16,000 字符总上限

## 3. 工具专属 Pending Action 投影

- [x] 3.1 定义 `exact`、`summarized`、`manual_only` 动作投影结果和 8,000 字符预算，并在 reviewer 之前处理 `manual_only` 人工回退
- [x] 3.2 为 `run_bash_command` 投影 cwd 与完整 command，覆盖 malformed 和超长 command 不调用 reviewer 的行为
- [x] 3.3 为 `apply_patch` 投影短 patch 原文和大 patch 的完整 add/update/delete 路径摘要、文件数、原始大小、头尾 excerpt 与截断标记；无法可靠恢复目标时回退人工
- [x] 3.4 为 `edit_file` 投影 path、`replace_all`、old/new 长度、有界头尾 excerpt 和截断状态
- [x] 3.5 为 MCP 和未来通用 approval-required tools 投影 tool identity、cwd、preview 及完整短参数，超长 MCP 或通用参数直接回退人工
- [x] 3.6 增加各工具精确、摘要、边界值、malformed 和 `manual_only` 测试，确认投影不读取文件、不模拟执行且不改变风险分类

## 4. Reviewer 时延与生命周期

- [x] 4.1 为每次 reviewer 请求组合 parent turn abort 与独立 10 秒 deadline，确保 provider 能收到取消信号并正确清理 timer/listener
- [x] 4.2 区分 parent abort、reviewer timeout、provider/config error 和非法响应：parent abort 继续中断 turn，其余情况只回退一次人工审批
- [x] 4.3 保持 reviewer 单次请求、无工具、`reasoningEffort: none`、无 reasoning summary、严格响应 parser 和 auto `allow_once` 语义
- [x] 4.4 增加 fake timer/可控 agent 测试，覆盖 deadline 前完成、timeout、与 parent abort 竞争、迟到 callback 隔离和不重试

## 5. 脱敏观测与验证

- [x] 5.1 扩展自动审批 debug 事件，记录 latency、prompt/action 字符数、上下文分区、动作投影类型及 `yes`、`no`、`timeout`、`error`、`manual_only` 稳定结果
- [x] 5.2 验证 debug 和 usage 写入失败不改变审批流程，日志不包含用户原文、澄清答案、动作正文、参数明文、模型响应或完整错误消息
- [x] 5.3 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.4 由用户手动验证 auto 模式下短请求引用、文件编辑、高风险 Bash、MCP、超长动作人工回退、provider timeout、Esc 中断和人工 surface 回退
