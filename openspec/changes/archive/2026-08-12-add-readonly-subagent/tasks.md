## 1. 协议类型与持久化基础

- [x] 1.1 定义可枚举的内置子 Agent目录、嵌套运行元数据、运行预算和专属 callback，并为新增结构字段补齐中文语义注释。
- [x] 1.2 定义判别式 `SubagentTranscriptRecord` 事件联合，覆盖 start、reasoning、assistant、tool call/result、completed、failed 和 cancelled，并提供稳定构造函数。
- [x] 1.3 扩展 transcript journal validator、session replay/preview 与相关纯类型，使合法子 Agent事件可增量持久化，非法事件按现有 journal 容错规则处理。
- [x] 1.4 将 `subagent` role 纳入统一 non-provider 判定，并让所有 provider converters、会话引用素材和上下文估算安全跳过该 role。

## 2. 子 Agent工具目录与运行时

- [x] 2.1 实现普通 `run_subagent` ToolHandler及参数/结果映射，通过现有 ToolRegistry和 ToolExecutor执行；工具 schema从子 Agent定义目录动态生成必填 `agent` enum及 name/description目录，并确保它只出现在允许委派的父 registry。
- [x] 2.2 扩展 agent/tool 装配入口以按显式 allowlist 构造真实裁剪的 registry，并为 `explorer` 只注册 read_files、glob、grep、Bash、只读 Web 和 use_skill。
- [x] 2.3 添加内置 `explorer` system prompt 与隔离 session 构造，沿用父配置 revision、cwd、项目指令、memory 和 skill catalog，但不继承父 records、todo、compaction 或 journal path。
- [x] 2.4 定义窄 `SubagentToolPort` 并在 agent runtime按父 run装配，通过端口列出可用定义并按 `agent`名称路由，同时向普通handler注入配置快照、子 runtime factory、预算、取消、change recorder、callbacks和record sink，而不让 tools层依赖 AppContext。
- [x] 2.5 通过 SubagentToolPort实现同步隔离运行，限制最大深度和每父 run四次委派，并把非取消失败归一化为外层 tool result。
- [x] 2.6 为会发布本地过程records的handler增加通用 transcript commit mode和record sink，确保子过程与结束后的外层call/result在runtime recordRegion和app transcript中保持同序同索引，且不按工具名分支。
- [x] 2.7 每次合法委派通过 runtime factory 创建新的子 agent loop runtime，固定其 prompt、allowlist和 MCP禁用，移除复用父runtime的递归RunAgent与隐藏第三参数协议，并验证连续委派取得不同runtime实例。
- [x] 2.8 建立同一 `loop-runtime` 包内独立的主 Agent runtime与 subagent runtime，分别保留业务 loop、工具执行、hook和callback编排，并从主入口移除 `runtimeOptions.kind`及全部子角色分支。
- [x] 2.9 定义专属 `SubagentLoopInput`、`SubagentLoopCallbacks`和 `RunSubagentAgent`，让 Port负责父级事件桥接；提取只包含无角色纯函数的共享模块，并让调用方直接引用新的主 runtime路径。

## 3. Bash 安全升级与审批

- [x] 3.1 新增固定的子 Agent Bash policy：严格只读 allowlist命令直接执行，其他命令在 interactive环境进入普通审批流程，在 headless环境直接拒绝，且不继承父级 interaction mode。
- [x] 3.2 扩展审批请求的受信任本地来源元数据，仅用于 `explorer` surface展示与迟到请求隔离；主 Agent和子 Agent共享 auto reviewer、会话授权与 allow-all缓存。
- [x] 3.3 为子 Agent Bash permission surface展示 agent来源与 command preview，并复用现有完整审批选项、会话授权写入和反馈语义。
- [x] 3.4 实现 headless fail-closed、父 change recorder复用、父 abort传播和审批 surface优先消费 Esc 的安全收尾。

## 4. App 状态与事件桥接

- [x] 4.1 新增 `SubagentRunContext`，管理 run identity、agent/task、活动阶段、elapsed anchor、streaming/reasoning草稿和内部 pending tool，且不覆盖父 `TurnContext.pendingToolCall`。
- [x] 4.2 在 assistant turn runner中桥接子 Agent callbacks：稳定事件立即追加 journal并渲染，瞬时 token只更新 pending，内部工具结果成对保存。
- [x] 4.3 在 success、failed、cancelled和异常中断路径清理子 Agent transient状态，并用父 turn/run identity隔离迟到 token、tool result、approval和 complete回调。
- [x] 4.4 扩展 RenderState/footer pending和共享 activity timer，使子 Agent thinking、reasoning、streaming、tool和 waiting-approval阶段持续显示身份、摘要与耗时。

## 5. 上下文压缩与协议隔离

- [x] 5.1 在主 provider records构造边界预先过滤 subagent records，并为 OpenAI Responses、OpenAI Chat、Anthropic和 Codex/Fake相关转换路径补齐防御性隔离。
- [x] 5.2 调整强制压缩最近 K 条边界计算，按 provider-facing records计数后映射到物理索引，同时继续保护外层 tool call/result配对。
- [x] 5.3 验证自动压缩、手动压缩、conversation reference和 usage/context估算只消费外层 `run_subagent` 结果，不消费内部过程。

## 6. 嵌套 Rail 渲染

- [x] 6.1 从现有 Bash renderer提炼通用 rail row primitive，并暴露不附加 block尾部空行的工具 call/result行级 renderer，保持现有 Bash外观和主题语义不变。
- [x] 6.2 扩展 transcript block分组以识别连续同 runId的 subagent事件，并实现外层 start、assistant/reasoning、终态和意外中断 rail投影。
- [x] 6.3 为工具行级renderer增加仅供子Agent嵌套使用的muted tone，在扣除外层rail宽度后复用Bash、read_files、grep、glob、Web和use_skill的解析、结构、状态文本、预算、metadata和fallback，并把内部所有样式统一映射为当前主题的toolOutput暗色。
- [x] 6.4 实现窄终端扁平降级、ANSI/宽字符安全换行、resize replay和外层 `run_subagent` pair结果正文去重。
- [x] 6.5 实现运行中 footer rail预览与稳定事件 append衔接，确保 token活动不触发 destructive repaint或重复提交历史内容。

## 7. 自动化测试

- [x] 7.1 添加 ToolHandler/Port和 agent runtime测试，覆盖普通registry/executor路径、无AppContext/headless运行、成功委派、隔离prompt/context、真实工具裁剪、伪造工具拒绝、预算、失败归一化和外层结果继续。
- [x] 7.2 添加 Bash审批测试，覆盖严格只读直通、共享 auto/cache、跨主/子来源会话授权复用、headless拒绝、反馈和父取消。
- [x] 7.3 添加 transcript/journal/provider测试，覆盖事件校验、增量 replay、未完成运行、主 provider隔离、会话引用隔离和 runtime/app索引一致性。
- [x] 7.4 添加 compaction测试，覆盖子 Agent过程不计 token/摘要、强制压缩按可发送记录保留 K 条和外层工具配对保护。
- [x] 7.5 添加纯renderer测试，覆盖暗色双层Bash rail、其他专属工具统一toolOutput色、失败仅靠文字表达、顶层工具颜色不回归、结果去重、实时/恢复投影、窄终端、中文宽字符、ANSI主题和无原始换行。
- [x] 7.6 添加 app controller测试，覆盖 footer阶段切换、审批 modal恢复、Esc取消、迟到 callback隔离和 response lock释放。
- [x] 7.7 调整并补充 runtime测试，验证父入口不含子角色开关、子入口不接收完整主 session/callback、连续委派创建独立子 runtime，且拆分前的成功、失败、审批、取消和provider隔离语义不回归。

## 8. 文档与验证

- [x] 8.1 更新相关架构文档，说明受控只读语义、Bash人工升级、子 Agent过程持久化和仅外层结果进入主上下文的边界。
- [x] 8.2 依次运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`，修复全部回归。
- [x] 8.3 由用户手动验证真实/假模型委派、长时间活动反馈、嵌套 rail、Bash允许/拒绝/反馈、Esc取消、resize、`/resume`、`/fork`、`/undo` 和 `--once` fail-closed行为。
