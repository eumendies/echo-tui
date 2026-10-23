## Purpose
定义默认关闭的本地 Code Mode 的配置准入、隔离执行、资源限制、审计和终端投影，以及可选路径的配对评估要求。

## Requirements

### Requirement: 可选的本地 Code Mode 入口
系统 SHALL 提供默认关闭的 `tools.codeMode.enabled` 配置，并在 `/config` 的“常规”Tab 提供遵守草稿、显式保存和下一轮生效规则的开关，具体交互见 `config-surface-settings`。仅当该字段为 `true`、隔离运行时可用且本次运行明确允许该能力时，主对话及 headless 的 provider-visible registry SHALL 增加 `run_code`；缺失或类型错误 SHALL 按关闭处理。启用 SHALL NOT 移除原生工具、新增 interaction mode 或要求模型强制使用脚本。配置与工具能力 SHALL 在运行 snapshot 中固定；子 Agent SHALL NOT 自动继承该入口。

#### Scenario: 默认保持既有工具行为
- **WHEN** 配置缺失、关闭或 `tools.codeMode.enabled` 不是 boolean
- **THEN** provider 请求 SHALL 不包含 `run_code`
- **AND** 原生本地工具、MCP 和审批行为 SHALL 保持不变

#### Scenario: 显式启用后允许模型自行选择
- **WHEN** 主对话或 headless 运行显式开启 Code Mode 且运行时可用
- **THEN** 模型 SHALL 同时获得 `run_code` 和原有可用工具
- **AND** 同一配置和准入条件的 normal 与 plan SHALL 保持相同工具定义集合
- **AND** 系统 SHALL NOT 要求简单任务先生成脚本

#### Scenario: 子运行及配置变化不扩张能力
- **WHEN** 已开启 Code Mode 的父运行创建子 Agent，或配置在脚本执行中改变
- **THEN** 子 Agent SHALL 不自动获得 `run_code`
- **AND** 已启动脚本 SHALL 继续使用原运行 snapshot 和可调用集合

### Requirement: 普通 JavaScript 与明确的 API 说明
`run_code` SHALL 只接受 JSON object 参数 `{code: string}`，并将 code 作为单次 async function 的函数体执行，支持 `await`、分支、循环与 `return`。系统 SHALL 为模型提供版本化输入/输出契约、限制和成功/失败小示例，仅暴露 `tools.glob`、`tools.grep`、`tools.read_files` 及有界 console。系统 SHALL NOT 需要 TypeScript 编译、包安装、任意 import、持久化 REPL 或通用工具发现服务。

#### Scenario: 脚本组合本地查询
- **WHEN** 脚本先等待 `tools.glob`，再将返回路径传给 `tools.grep` 并返回聚合结果
- **THEN** 系统 SHALL 在同一次外层调用中执行该依赖链
- **AND** 脚本 SHALL 获得与公开契约一致的机器数据，而不是工具展示文本

#### Scenario: 语法错误与不支持的语法可定位
- **WHEN** code 存在语法错误、import 或不支持的 TypeScript 类型语法
- **THEN** 系统 SHALL 返回明确的脚本错误及可用的位置诊断
- **AND** 语法解析失败 SHALL 不启动任何内部工具调用

### Requirement: 隔离执行与不可降级的能力边界
脚本 SHALL 在不直接执行宿主 JavaScript 的独立隔离环境中运行。系统 SHALL NOT 向脚本暴露 Node API、宿主对象或函数引用、环境变量、凭据、直接文件/网络/进程能力及任意模块加载。桥接 SHALL 只接收有界、合法、符合当前执行身份的 JSON 消息，并在宿主侧校验。隔离不可用时 SHALL 保持原生工具可用，隐藏新增定义并给出本地说明；已收到的显式调用 SHALL 返回 `runtime_unavailable`，SHALL NOT 降级为 `node:vm` 或普通 Node 代码执行。

#### Scenario: 直接访问宿主能力失败
- **WHEN** 脚本尝试访问 `process.env`、`require`、`fs`、直接网络或通过构造器链获取宿主能力
- **THEN** 系统 SHALL 不执行对应宿主操作
- **AND** 失败 SHALL 受控返回且不导致 TUI 主进程崩溃

#### Scenario: 伪造桥接与修改对象不能提升权限
- **WHEN** 脚本修改 `tools` 原型、伪造方法名或提交非法/过大/错误 execution ID 的桥接消息
- **THEN** 宿主 SHALL 在工具执行前拒绝消息
- **AND** SHALL 不根据 guest 声称的权限或执行身份调用 handler

#### Scenario: 隔离运行时不可用
- **WHEN** 运行时无法加载、初始化或不能实施所需隔离限制
- **THEN** 系统 SHALL 不启用替代的不安全执行方式
- **AND** 原生工具 SHALL 继续可用

### Requirement: 内部调用遵守本地工具准入与运行策略
内部调用 SHALL 仅允许 `glob`、`grep` 和 UTF-8 文本 `read_files`，且必须命中本次运行实际允许的工具集合。宿主 SHALL 在 handler 执行前应用既有 mode-aware/readonly/headless 策略和取消检查，SHALL NOT 直接调用裸 executor 绕过策略。外层允许、会话授权、auto approval 和 `--full-access` SHALL NOT 扩张脚本白名单或解除隔离。工作目录 SHALL 在外层调用开始时固定，路径能力 SHALL 不超出对应原生工具已有边界。

#### Scenario: plan 和 headless 执行白名单内只读查询
- **WHEN** plan 或 headless deny 策略运行中，脚本调用获准的 `glob`、`grep` 或文本 `read_files`
- **THEN** 系统 SHALL 按对应只读工具策略执行
- **AND** SHALL 不启动额外审批或等待 headless stdin

#### Scenario: 拒绝脚本调用白名单外工具
- **WHEN** 脚本尝试 Bash、编辑、MCP、网络工具、用户问题、子 Agent 或嵌套 `run_code`
- **THEN** 系统 SHALL 返回工具不可用或权限拒绝
- **AND** SHALL 不执行工具、不打开审批 surface
- **AND** `--full-access` 或已有会话级 allow-all SHALL 不改变该结论

#### Scenario: 受限运行不经脚本恢复被移除的工具
- **WHEN** 本次运行未获准某个内部工具，即使该工具属于三个固定候选方法之一
- **THEN** 对该工具的调用 SHALL 在数据采集前被拒绝
- **AND** 宿主 SHALL 不从全局 registry 借用该工具绕过本次限制

### Requirement: 有界执行与单次完成
系统 SHALL 限制源码 32 KiB、guest 堆 32 MiB、累计 guest 活跃计算 1,000ms、整次执行墙钟 30 秒、内部调用尝试 16 次、并发活动调用 2 个、单次 JSON 参数 32 KiB、单次工具 JSON 响应 64 KiB、累计工具 JSON 响应 512 KiB、最终 JSON 返回值 16 KiB、日志 32 条且合计 8 KiB。所有字节限制 SHALL 按 UTF-8 计算；工具等待 SHALL 不计入活跃计算时间，但计入墙钟。非法及被拒绝尝试 SHALL 计入调用预算。系统 SHALL 在无界分配或跨边界传输前实施对应预算，不能通过先构造任意大字符串再截断来宣称有界。

#### Scenario: 无限循环与工具洪泛被限制
- **WHEN** 脚本执行无限循环、不断派发调用或一次构造大量并发 Promise
- **THEN** 系统 SHALL 在对应预算内中止或拒绝超额工作
- **AND** 宿主活动工具数 SHALL 不超过 2，调用尝试 SHALL 不超过 16
- **AND** 不可恢复限额触发后 SHALL 关闭派发，即使脚本捕获错误也不得恢复执行能力

#### Scenario: 超大日志和最终结果
- **WHEN** 日志超过条数/字节限制或脚本最终值超出 16 KiB JSON
- **THEN** 日志 SHALL 有界截断并注明丢弃情况
- **AND** 超大的最终值 SHALL 返回明确失败，而不是损坏或静默丢字段的 JSON

#### Scenario: 内存分配失败被捕获
- **WHEN** guest 的内存申请被 32 MiB 堆限制拒绝，且脚本捕获分配异常
- **THEN** 系统 SHALL 保持原内存上限，允许脚本继续受原有计算、墙钟、调用及权限限制约束的执行
- **AND** 系统 SHALL NOT 承诺检测或报告已被 guest 捕获的历史内存分配失败
- **AND** 该例外 SHALL NOT 恢复已因其他不可恢复限额或取消而关闭的工具派发

#### Scenario: 内存分配失败未被捕获
- **WHEN** guest 没有捕获内存不足错误
- **THEN** 外层执行 SHALL 以 `memory_limit_exceeded` 失败并停止后续工具派发
- **AND** 系统 SHALL 清理本次独占的 guest 状态和受管理资源

#### Scenario: 返回值不可序列化
- **WHEN** 脚本返回循环对象、BigInt、函数、Symbol、非有限数或其他不能保持 JSON 语义的值
- **THEN** 系统 SHALL 返回 `serialization_error`
- **AND** 没有显式返回的脚本 SHALL 唯一归一化为 `null`

#### Scenario: 未等待内部调用就返回
- **WHEN** 脚本返回时仍存在活动或排队的内部调用
- **THEN** 执行 SHALL 以 `pending_tool_calls` 失败并停止派发、取消未完成工作
- **AND** 外层终态提交后 SHALL 不继续执行后台任务

### Requirement: 取消传播和迟到结果隔离
Esc、turn abort、进程关闭或执行超时 SHALL 先关闭 bridge，再取消队列、活动本地工具和 guest。系统 SHALL 将信号传播到底层 ripgrep 子进程和文本读取 stream；取消或超时后 SHALL 至多在 1 秒内进入强制终止流程。每次执行 SHALL 只有一个终态，关闭后的回调 SHALL 不修改新 turn、不追加结果或重新绘制终端。系统 SHALL 不自动重跑已部分执行的脚本。

#### Scenario: 用户中断进行中的脚本
- **WHEN** 脚本正在等待本地查询且用户按 Esc
- **THEN** 系统 SHALL 停止新派发并取消已有查询与隔离进程
- **AND** 外层调用 SHALL 按现有中断配对语义收尾，保留已完成调用摘要
- **AND** 迟到结果 SHALL 不进入后续 assistant turn

#### Scenario: 底层资源实际释放
- **WHEN** 文本读取、ripgrep 查询或无响应的 guest 被取消或超时
- **THEN** 系统 SHALL 关闭 stream、终止受管理的查询/执行进程并清理计时器和监听器
- **AND** SHALL 不仅以提前结束 Promise 代替资源清理

### Requirement: 外层结果与内部审计分离
系统 SHALL 仅为 `run_code` 生成普通 provider tool call/result 对，外层结果 SHALL 包含有界最终值、日志和执行摘要，失败 SHALL 提供错误 code、阶段、可用位置及已完成/失败调用数量。内部调用 SHALL 使用本地 `code_execution` 事实记录关联外层 call ID、execution ID、事件序号与子调用序号；记录 SHALL 保留有界操作摘要、状态、耗时和错误，不复制完整文件正文或中间结果，审计摘要总计 SHALL 不超过 32 KiB 并预留终态空间。真实内部调用 SHALL 产生关联清晰且至多一次的开始/结束观测，不冒充 provider 自己发出的工具调用。

外层结果 SHALL 使用固定字段 `status`、`result`、`logs`、`logs_truncated`、`summary`、`error`；status SHALL 为 succeeded、failed 或 cancelled，失败时 result SHALL 为 null。summary SHALL 包含内部调用的 attempted/completed/failed/cancelled 计数和耗时；error SHALL 为 null 或包含 code、message、phase 及可用脚本位置的对象。phase SHALL 为 compile、runtime、tool 或 serialize。turn 已取消时 SHALL 优先遵守既有中断配对和清理，而非等待该普通结果。

#### Scenario: 多步脚本只向模型返回选中数据
- **WHEN** 脚本读取多个文件后仅返回一个统计对象
- **THEN** 模型 SHALL 接收外层脚本结果而非所有内部读取正文
- **AND** 内部审计 SHALL 不作为普通 `tool_call` 或 `tool_result` 混入 provider continuation

#### Scenario: 脚本中途失败可解释且不自动重跑
- **WHEN** 前两个内部调用完成后脚本抛错
- **THEN** 失败结果 SHALL 表达错误阶段及已完成调用数量
- **AND** 本地记录 SHALL 保留已完成调用和唯一执行终态
- **AND** 系统 SHALL 不声称此前操作回滚或自动从头执行

### Requirement: 审计恢复与终端投影
交互运行的 `code_execution` 记录 SHALL 能通过 JSONL journal 写入、恢复、分叉和预览路径识别；SHALL 从所有 provider 请求、token 估算、压缩输入及面向模型的会话引用中排除。TUI SHALL 在外层脚本下展示有界子调用摘要和终态，遵守主题、终端宽度、resize 及既有清理策略。Headless SHALL 继续不创建 transcript session、不初始化 TUI，仅保留外层结果和受控观测。

#### Scenario: 会话恢复保留审计但不重新执行
- **WHEN** 用户恢复或分叉包含 Code Mode 记录的会话
- **THEN** 系统 SHALL 恢复可读的执行/子调用摘要
- **AND** SHALL 不重新执行脚本或将内部事件加入模型上下文及压缩输入
- **AND** 关闭 Code Mode SHALL 不影响已有记录的读取

#### Scenario: 工具块视觉层级与消息分隔
- **WHEN** Run code 通过 footer 进度或历史块展示执行状态
- **THEN** 执行标题和进度 SHALL 保持正常亮度，状态 marker SHALL 沿用普通工具配色
- **AND** Result/Logs 标签与正文 SHALL 使用 Bash 的 toolOutput 弱化色且不额外叠加 ANSI dim，Error 标签与错误正文 SHALL 使用正常亮度的 toolError
- **AND** 执行终态或非活动恢复块 SHALL 与下一条消息保留一行空白
- **AND** 活动进度及重复回调 SHALL NOT 向稳定历史累积标题、计数或空行

#### Scenario: 逐事件进度只重绘临时区域
- **WHEN** start、call_start、call_end 和 end 审计分别触发真实应用回调
- **THEN** 系统 SHALL 仅更新有界分组事实及身份匹配的 footer pending 进度，不追加稳定历史块
- **AND** 单工具 pending SHALL 保留真实外层 call ID，不按最近执行猜测进度归属
- **AND** 外层 tool_result 到齐后 SHALL 唯一追加含终态标题、按序子调用、一份摘要及实际预览的完整块，成功审计的通用诊断 SHALL NOT 重复计数

#### Scenario: 共享 Bash rail 并观察实际返回值
- **WHEN** Run code 显示 pending、执行进度或完成后的外层响应
- **THEN** 系统 SHALL 复用 Bash 的共享 rail 布局，不混用树枝前缀
- **AND** 完成结果 SHALL 从真实外层响应预览 result、logs 和非 null error，不以内部调用计数代替返回内容
- **AND** 预览标题 SHALL 使用 `Result:`、`Logs:`、`Error:`，空日志 SHALL 显示 `Logs: (none)`
- **AND** 系统 SHALL NOT 展开脚本源码、所有中间响应或改变原始 provider 响应和持久化事实

#### Scenario: 预览有界且截断口径明确
- **WHEN** 返回值、日志或错误的展示内容过长
- **THEN** 每节缓存 SHALL 至多保留 12 个逻辑行且 4096 字符，正文绘制 SHALL 至多保留 12 个物理行并附独立的仅展示截断说明
- **AND** 真实 logs_truncated SHALL 单独说明，返回 JSON 内的 has_more/truncated SHALL 保留原值，不与展示截断混淆
- **AND** 预览 SHALL 用 JSON 转义保留控制字符的数据含义，不执行终端指令或缓存原始结果对象

#### Scenario: 审计终态先于真实外层结果
- **WHEN** 活动执行已收到审计 end，而实际外层结果稍后到达
- **THEN** footer SHALL 显示 finishing 并继续缓冲，直到外层结果到齐才提交一个完整终态块
- **AND** 活动 resize SHALL 先重建当前窗口的分组事实，再绘制 footer，SHALL NOT 提前写入终态或不可用预览
- **AND** 重复结果 SHALL NOT 重复展示；恢复 SHALL 不重新执行，窗口逐出 SHALL 释放缓存
- **AND** 非活动历史缺失有效外层结果或结果畸形时 SHALL 明确说明预览不可用，不捏造返回字段

#### Scenario: headless 不引入交互与持久化
- **WHEN** `--once` 执行启用的 `run_code` 并成功、失败或收到信号
- **THEN** 系统 SHALL 不创建会话、不进入 raw mode、不输出 TUI ANSI 或等待 stdin
- **AND** 清理后 SHALL 继续按既有 headless 输出和退出规则收尾

#### Scenario: 不可信内容不能变成终端控制指令
- **WHEN** 文件路径、脚本日志或错误摘要包含 ANSI、CR 或其他终端控制字符
- **THEN** renderer SHALL 按既有净化规则安全投影，不执行内容中的终端指令
- **AND** 展示净化 SHALL 不修改供脚本处理的源文件数据

### Requirement: 非专项训练模型的可选路径与配对评估
系统 SHALL 提供保留原生工具的提示和失败诊断，不假设模型经过 Code Mode 专项 RL。推广前 SHALL 使用相同任务、模型配置、工具预算和独立验收器，对“原生工具”与“原生工具加可选 Code Mode”进行配对评估，单列模型实际采用脚本的情况、脚本首次成功率、任务最终成功率、修复次数、总 token、耗时、工具次数和越权/副作用；修复成本 SHALL 计入总量。评估 SHALL 与默认离线测试分离，不能将模型自报成功或某个模型的收益泛化为全部模型的可靠性承诺。

#### Scenario: 失败后改用原生工具完成任务
- **WHEN** 模型的脚本失败并决定改用原生工具
- **THEN** 原生工具 SHALL 仍可用
- **AND** 评估 SHALL 分别记录脚本首次失败和任务最终结果，不把修复成本从统计中删除

#### Scenario: 评估发现越权或无明确收益
- **WHEN** 验收发现实际越权，或配对结果显示最终成功率/成本明显恶化
- **THEN** 实际越权 SHALL 阻止发布
- **AND** 无明确收益的模型 SHALL 不被自动启用或宣称更可靠
- **AND** 本变更 SHALL 继续保持默认关闭
