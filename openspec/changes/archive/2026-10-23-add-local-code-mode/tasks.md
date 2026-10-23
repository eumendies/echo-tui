## 归档状态说明

2026-10-23，用户明确要求“全部勾选然后继续归档”，并确认同步主规格。本文件的 38 项任务据此全部关闭；1.2、2.6、5.4、6.6、7.3、8.2 的勾选仅表示按用户决定关闭流程，不表示尚缺证据的实际信号终止、真实模型评估或人工 TTY 验收已经通过。真实覆盖、跳过原因和后续验收条件继续保留在 `verification.md`，不因归档而改写。

## 1. 隔离运行时前置验证

- [x] 1.1 验证 QuickJS/WASM 候选包在 Node >= 20.3、CommonJS 和现有 tsc 构建下的加载、WASM 资源分发及 npm pack 安装；记录选定版本和跨平台限制，不引入 bundler 或 loader。
- [x] 1.2 用独立进程验证 async/Promise job pumping、guest 内存限制、累计活跃计算中断和父进程强制终止；验证不能获取 Node、环境变量、文件、网络和模块能力。不满足时停止执行器接入并记录阻塞项。

## 2. 本地工具数据契约

- [x] 2.1 定义 v1 envelope、三个方法的输入/输出 schema、稳定错误 code 和生成的精简 API 说明；加入 schema、说明、真实结果的一致性测试。
- [x] 2.2 整理 glob 的共用归一化与采集边界，提供 paths/has_more 脚本数据及 JSON 预算投影；覆盖无匹配、`.git`、隐藏文件、条数/字节截断和 ripgrep 失败。
- [x] 2.3 整理 grep 的共用采集边界，提供 matches/has_more；覆盖 UTF-8 字节列、literal/case_sensitive、无匹配、长源行和完整匹配项预算。
- [x] 2.4 提供 read_files 文本专用采集入口及逐文件结果；在多媒体处理前拒绝目录、图片、PDF、特殊文件，覆盖编码、分页、EOF、空文件和批量部分失败。
- [x] 2.5 实现文本内容/JSON envelope 的分层预算和可靠 next_offset；覆盖长行被截断后不能跳行续读、完整行边界截断及单项无法装入预算。
- [x] 2.6 为 glob、grep 和文本 reader 接通真实 AbortSignal，取消时终止 ripgrep/关闭 stream；回归原生工具文本、附件和 display metadata，确保不解析展示文本或双重执行采集。

## 3. 配置与模型可见入口

- [x] 3.1 接入 `tools.codeMode.enabled` 默认关闭的归一化设置和 run snapshot；测试缺失/无效字段、热刷新仅影响后续运行及配置写入保留未知字段。
- [x] 3.2 添加 `run_code` 定义和主对话/headless 装配；保留原生工具，维持 normal/plan 定义一致，禁止子 Agent 自动继承并遵守外层 allowed-tool 集合。
- [x] 3.3 提供从契约生成的短说明及成功/失败脚本示例，明确 async 函数体、JSON 返回、截断处理、原生工具可选与不可用 Node API；测试关闭功能时不增加说明上下文。
- [x] 3.4 实现运行时就绪检查和不可用路径：隐藏新增定义、一次本地说明、显式调用返回 runtime_unavailable，不能降级为宿主代码执行。
- [x] 3.5 在 `/config` →“常规”的共享行定义、handler 和 renderer 添加 Code Mode 开关及说明，支持 Enter/Left/Right 修改草稿，纳入 dirty fingerprint、Tab 切换保留和未保存关闭确认；覆盖审批模型动态行共存时的焦点与鼠标交互。
- [x] 3.6 扩展“保存常规设置”，原子写入 `tools.codeMode.enabled` 并保留同节点未知字段、其他 tools 设置及其他 Tab 草稿；测试保存成功不关闭、保存失败不丢草稿、不在切换或保存时发起模型/工具/审批。
- [x] 3.7 接通保存/watcher 的共享 snapshot 刷新及下一轮工具目录生效，清理失效 context usage 而不完整重绘 transcript；覆盖执行中开关切换、原生工具保留、headless 同配置和运行时不可用时配置意图不被回写。

## 4. 隔离执行和资源预算

- [x] 4.1 实现单次独立进程及 QuickJS context 生命周期，加载固定 tools/console，禁止模块及直接宿主能力；运行结束释放句柄、context、进程、计时器和监听器。
- [x] 4.2 实现严格 JSON IPC 协议及执行/调用身份校验，处理未知方法、超大消息、非法 JSON、原型污染与伪造执行身份，加入隔离回归用例。
- [x] 4.3 实施源码/参数、guest 堆、累计计算、墙钟、调用尝试、并发、单次/累计响应、日志和最终结果限额；验证不可恢复限额被捕获后不能恢复派发，堆分配失败可捕获且未捕获时外层失败。
- [x] 4.4 实现 JSON 返回值验证、空返回归一化、脚本位置映射和有界错误诊断；覆盖循环对象、BigInt、非有限数字、超大/深层值和序列化期间超时。
- [x] 4.5 实现未 await 调用检测、pending_tool_calls 收尾、调用队列取消和终态唯一提交；测试不产生后台工作或自动脚本重跑。

## 5. 策略感知工具桥接

- [x] 5.1 整理可供真实内部调用复用的现有执行前策略边界，传递运行 mode、tool policy、执行模式和取消信号，不能由脚本直接调用裸 executor。
- [x] 5.2 实现固定候选白名单与本次工具集合交集、固定 cwd、输入校验及机器结果通道；覆盖受限 registry 中缺失工具与绝对/相对路径的原生兼容行为。
- [x] 5.3 覆盖 normal/plan/readonly/headless deny/full-access、manual/auto approval、会话 allow-all 矩阵；确认白名单外的 Bash/编辑/MCP/网络/用户问题/子 Agent/递归调用始终拒绝。
- [x] 5.4 把 Esc、turn abort、进程信号及 watchdog 贯通至队列、工具和 guest，验证至多 1 秒进入强制终止，迟到回调不影响新 turn 或已关闭执行。

## 6. 审计、持久化与展示

- [x] 6.1 定义有界 code_execution 本地事件，关联外层 call ID、execution ID、事件序号与子调用序号，预留终态预算；内部记录不得复制文件正文或完整中间响应。
- [x] 6.2 接通真实内部调用的开始/结束观测与 lifecycle hooks 归因，处理拒绝、失败、取消及重复回调；测试 hook/debug payload 有界且不泄露新增宿主状态。
- [x] 6.3 接通 JSONL 读写、恢复、分叉、预览及清理；测试关闭 Code Mode 仍可读取旧记录，恢复和分叉不重新执行脚本。
- [x] 6.4 在全部 provider converter、token 统计、压缩与会话引用投影中排除内部事件；验证模型协议只有合法外层 call/result 对，Esc 后配对仍正确。
- [x] 6.5 实现 Run code 的 Bash 共享 rail：审计进度仅更新身份匹配的 footer，外层结果到齐后唯一追加完整终态块；展示按序子调用、一份摘要和 Result:/Logs:/Error: 实际预览，结果与日志标签及正文用 Bash toolOutput 弱化色、错误标签及正文用 toolError；独立限行并区分展示与真实截断；测试真实逐回调 AppRenderer/TurnContext、审计 end 与外层结果间隔、重复事件、恢复/resize/主题/极窄屏/缓存逐出与块尾单空行，不切换 alternate screen。
- [x] 6.6 覆盖 headless 成功、失败、非 TTY 和信号清理，确认无 session、无 raw mode、无 TUI ANSI、无 stdin 等待，外层结果继续走既有退出规则。

## 7. 模型适用性评估与使用说明

- [x] 7.1 构建临时目录中的离线任务 fixture 和独立验收器，覆盖简单查询、跨文件筛选、分支、聚合、无匹配、部分失败、分页及错误修复，不以模型自报完成计分。
- [x] 7.2 提供独立可复现的配对评估入口，固定模型/推理/预算，记录是否采用脚本、首次及最终成功率、修复次数、总 token/耗时/工具数和副作用；不进入默认 npm test。
- [x] 7.3 与用户确认真实模型和调用预算后执行评估、保留原始结果及失败样例；实际越权阻止发布，收益不足不自动启用，不对未经测试模型宣称可靠性提升。
- [x] 7.4 更新文档说明 `/config` →“常规”开关和配置文件开启/关闭、显式保存及下一轮生效、一期白名单、API 和示例、读路径边界、预算、错误恢复及实验性质，明确 MCP/Bash/编辑/持久化状态不在本次范围。

## 8. 完整验证与人工验收

- [x] 8.1 按顺序运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`，补齐回归并记录结果。
- [x] 8.2 运行 `npm start`，手动检查输入/换行/提交/流式响应、脚本及原生工具展示、footer/resize、Esc/退出清理和关键 slash/mode/approval 交互；额外检查 `/config` Code Mode 默认值、切换/保存/放弃、重新打开及下一轮生效，记录无法覆盖项。
- [x] 8.3 用 fake agent 和非 TTY 验证 `--once`、默认拒绝与 `--full-access` 不扩张脚本白名单、配置/provider 失败退出码及重复执行后的资源释放。
- [x] 8.4 重跑 OpenSpec 严格校验并更新验证记录；未获用户确认不提交、不合并、不归档该变更。
