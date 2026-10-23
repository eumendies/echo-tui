## Context

本变更落实 `proposal.md` 的本地工具优先方向。当前 `prepareAgent` 将 registry 同时交给 provider 和 executor；`createToolExecutor` 只负责工具查找、JSON object 解析和 handler 执行，plan/readonly/approval 判断实际位于 agent loop。直接从脚本调用 executor 会绕过后者，因此新增入口必须复用运行策略，而不是仅组合 handler。

`glob`、`grep` 已采集路径及匹配项，但相关 `details.display` 明确属于 UI；`read_files` 的文本 reader 也有分页数据，外层目前主要返回格式化字符串。脚本需要独立、稳定、可校验的数据契约，不能解析展示 envelope 或把 UI metadata 升格为隐式 API。

现有 Bash 沙箱允许在某些配置下关闭或降级，并不构成脚本运行时的隔离保证。本变更不复用该降级语义，也不改变项目 CommonJS、Node >= 20.3、无 bundler、ANSI/raw-mode 的约束。

## Goals / Non-Goals

**Goals:**

- 为本地查询和文本分析提供可选 `run_code`，保留原生工具与普通 function tool provider 协议。
- 明确工具输入、输出、失败、分页、截断和生命周期，降低没有专项 Code Mode 训练的模型的试错成本。
- 每次执行隔离、无状态、权限不扩张，可取消且可审计，中间结果不自动回流模型。
- 在现有 `/config` →“常规”提供默认关闭的开关，使用与配置文件一致的值和下一轮生效语义。
- 使用配对任务评估实际模型适用性，而不是用“会写 JS”代替可靠性证明。

**Non-Goals:**

- MCP、Bash、编辑、网络工具、用户交互、子 Agent 或嵌套 `run_code` 的脚本调用。
- 图片、PDF、目录枚举和非 UTF-8/二进制文件的脚本读取；它们仍可走原生 `read_files`。
- 强制模型采用 Code Mode、移除原生工具、自动判断某模型经过专项 RL。
- TypeScript 编译、npm 包、任意 import、持久化 REPL、跨调用结果句柄、定时任务或后台执行。
- 新 slash command、CLI flag、独立的 `/config` Tab/页面、通用工具搜索服务或新的审批机制。

## Decisions

### 1. 默认关闭的增量工具，而不是新的交互模式

配置使用 `tools.codeMode.enabled`，缺失或非 boolean 按 `false` 处理，纳入现有不可变 run snapshot。显式开启且运行时就绪时，主对话与 headless 在同一配置和准入条件下增加 `run_code`；normal 与 plan 保持同一工具定义集合，只在执行时应用模式策略。子 Agent 不继承该入口；受限运行的外层 allowed-tool 集合必须明确允许 `run_code`，内部工具也必须逐个命中本次可调用集合。

普通工具 definitions 保留，供模型修正脚本或选择直接调用。配置变化只影响下一次运行 snapshot，不改变已经执行中的脚本。关闭后旧会话中的 `run_code` 历史仍可读取，但不能据此再次启动执行。

`/config` →“常规”新增“Code Mode”开关行，显示归一化的“开/关”，说明其用于脚本编排本地只读工具且下一轮生效。Enter、Left 或 Right 切换草稿，未保存时不写文件或修改运行能力；保存复用“保存常规设置”，将 boolean 原子写入 `tools.codeMode.enabled`，只更新该字段，保留 `tools.codeMode` 的未知子字段、其他 tools 配置及其他 Tab 未提交草稿。成功保存更新 dirty fingerprint 和共享用户配置 revision，保持配置中心打开；取消关闭沿用统一未保存确认，写入失败保留草稿并展示错误。

UI 与 headless 使用同一归一化配置。保存或 watcher 刷新仅改变后续运行，当前 turn 的工具目录和脚本不增删、不强制中断；清理因工具 schema 变化失效的 context usage 快照，不为切换开关 destructive replay transcript。开关展示配置意图，不等同于隔离运行时就绪；调整或保存不能启动脚本、发起模型请求或触发审批，开启后运行时仍不可用时按既定不可降级规则处理，而不是自动把持久化开关改回关闭。

备选“全部工具只暴露为代码 API”会放大未专项训练模型的失败成本；备选 `/mode code` 会混淆权限模式与工具编排方式，均不采用。

### 2. 固定、短小的脚本 API

`run_code` 输入只接受 `{code: string}`。`code` 是一个 async function 的函数体，可以使用顶层 `await` 和 `return`，不能携带独立 import 或 TypeScript 类型语法。只注册以下宿主能力：

- `tools.glob(args)`
- `tools.grep(args)`
- `tools.read_files(args)`
- 有界的 `console.log/warn/error`

不提供任意工具名分派器；这些方法仍需在宿主侧执行固定白名单与本次 registry 交集检查，不能仅依赖隐藏方法名。脚本对 `tools` 的重赋值、原型修改或伪造 IPC 消息不能改变宿主权限。

输入参数名与原生工具一致。每个方法返回 `schema_version: 1` 的统一结果 envelope，详见 `local-tool-script-contracts/spec.md`。普通工具失败返回 `ok: false`，脚本可以显式分支；隔离、取消、不可恢复限额及契约校验失败是不可继续派发的执行级错误，不能被脚本 `catch` 后恢复工具能力。内存分配失败的例外语义见下方资源预算：不放宽堆上限，但允许 guest 捕获分配失败后继续受限执行。

启用时的 `run_code` 说明包含三个方法的精简输入/输出契约、返回值约束、限额、普通工具优先提示，以及成功/失败两个完整小示例。说明从维护的契约生成，不由模型根据样本推断；一期不增加 `search_tools`。

示例使用拟议的统一结果：

```javascript
const files = await tools.glob({pattern: "src/**/*.ts"});
if (!files.ok) return {error: files.error};
if (files.data.paths.length === 0) {
  return {matches: [], incomplete: files.data.has_more};
}
const matches = await tools.grep({pattern: "TODO", paths: files.data.paths});
if (!matches.ok) return {error: matches.error};
return {
  matches: matches.data.matches,
  incomplete: files.data.has_more || matches.data.has_more
};
```

### 3. 独立子进程中的 QuickJS/WASM，失败时不降级

选择 QuickJS/WASM 作为首选执行引擎，在受宿主管理的独立子进程内创建每次调用独占的 runtime/context。JavaScript 不直接由 Node `eval`、`Function` 或 `node:vm` 执行。子进程用于可强制结束和故障隔离，不单独宣称为安全沙箱；核心能力边界是 QuickJS 的无宿主 API 环境、WASM 隔离与严格 JSON 桥接。系统支持时可叠加 OS 沙箱，但不能用 OS 沙箱可选或关闭来放开 JS 能力。

宿主不向 guest 传递 Node 对象、函数引用、句柄、`process`、`require`、`Buffer`、环境变量、MCP 连接或凭据；拒绝模块加载、直接网络、文件和进程访问。跨边界参数与结果只使用经过大小检查及结构校验的 JSON 数据。父进程只接受已有执行 ID 的合法 bridge 消息；IPC 协议、消息长度和方法名在调用 handler 前校验。

依赖的 Node/CommonJS/WASM 加载、异步 Promise job pumping、内存限制与 interrupt 支持是实施前置验证项。不可用时隐藏新增工具并给出一次本地说明，原生工具继续可用；已收到的显式调用返回 `runtime_unavailable`。绝不回退到普通 Node 执行。

### 4. 在策略边界内复用采集逻辑

```text
run_code
  └─ run 固定配置、工作目录和可调用集合
      └─ 子进程 QuickJS
          └─ JSON RPC：工具名、参数、调用序号
              └─ 宿主校验、准入、策略、并发、取消检查
                  └─ 现有本地工具的归一化与有界数据采集
                      ├─ 原生调用：既有文本/附件/display
                      └─ 脚本调用：版本化机器数据
```

将 agent loop 的工具风险/审批执行边界整理为可由真实内部调用复用的能力，不能从 `run_code` handler 直接递归调用裸 executor。内外调用必须使用同一 run 的策略和状态。当前白名单只有三个只读工具，normal、plan 和 headless deny 策略可按既有只读规则执行；若将来出现需要审批的候选调用，应先被一期白名单拒绝，不因缓存授权、auto approval 或 full-access 放开。

工作目录在外层调用开始时固定，相对路径由宿主解析。`read_files` 的绝对路径与 `..` 能力继续遵守已有本地工具边界，不新增“所有读取都只在 workspace 内”的虚假保证；`.git`、类型判断和原生路径限制保持一致。宿主只读工具本身仍是可信执行能力，QuickJS 隔离不代替其路径安全和数据预算。

同一次采集可以生成不同投影，但不执行两遍工具、不解析现有文本、不通过多媒体 reader 再丢弃附件。脚本文本读取在类型分派前拒绝目录、图片、PDF 与特殊文件；文本读取期间出现二进制/无效编码按既有规则失败。

### 5. 固定资源预算与完成边界

一期采用以下固定上限，暂不开放模型参数或用户配置调大：

| 资源 | 上限与语义 |
| --- | --- |
| 脚本源码 | 32 KiB UTF-8，启动子进程前检查 |
| Guest JS 堆 | 32 MiB；超额分配被拒绝，允许捕获分配错误；不代表整个 Node 子进程 RSS 上限 |
| Guest 活跃计算 | 累计 1,000ms，工具等待不计入，覆盖 Promise job 和最终值转换 |
| 整次执行 | 30 秒墙钟，包含排队、工具等待与收尾，由父进程 watchdog 兜底 |
| 工具调用尝试 | 16 次，非法方法/参数和被拒绝尝试也计数 |
| 并发 | 最多 2 个宿主调用，其余在最多 16 次总预算内排队 |
| 单次工具响应 | 完整 JSON envelope 最多 64 KiB，不能仅限制展示字符串 |
| 累计工具响应 | 512 KiB，所有返回 envelope 的 UTF-8 JSON 字节总和 |
| 最终返回值 | UTF-8 JSON 最多 16 KiB，超限明确失败，不截断成无效 JSON |
| 日志 | 最多 32 条且共 8 KiB；超出后截断并带计数/标记，不继续累积 |
| 父进程强制清理 | 取消或超时后至多 1 秒进入强制终止，不等待 guest 配合 |

JSON 参数同样不得超过 32 KiB；序列化不能先无界物化再检查，深度与循环对象需受控拒绝。工具采集应先按单项预算保留完整路径、匹配项和文本行，再构造 JSON；不能把未闭合 JSON 当作结果。

用户确认保留现成 QuickJS 引擎，不维护定制 WASM：guest 可捕获内存分配失败并在原有堆、CPU、墙钟、调用和权限预算内继续执行；未捕获的内存错误使外层以 `memory_limit_exceeded` 失败。宿主不保证记录已被 guest 捕获的历史内存失败，也不从采样用量推断该历史。此例外不适用于取消、计算/墙钟、调用次数、参数/响应/最终值等不可恢复限额；日志仍采用已有的有界截断语义。

`return` 只接受 JSON 值；没有显式返回按 `null`。循环引用、BigInt、函数、Symbol、非有限数字及无法保持 JSON 语义的对象明确返回 `serialization_error`，不静默丢字段。脚本返回时仍存在未结束的工具调用，执行以 `pending_tool_calls` 失败，关闭派发并取消剩余工作；不允许任务在外层结果提交后继续运行。已完成的调用摘要保留，不回滚、不自动重跑整段脚本。

### 6. 取消和迟到结果不跨运行生效

外层状态机为 `created → running → closing → succeeded/failed/cancelled`，终态唯一。Esc、turn abort、进程关闭或 watchdog 首先关闭 bridge，再取消队列/活动调用和 guest。为 glob、grep 和文本读取补齐真实运行所需的 AbortSignal 传播：终止 ripgrep 子进程、关闭读取 stream，不能只让 Promise 提前 resolve。

外层 signal 使用现有 agent loop 中断语义，不在已取消 turn 中强行添加普通 provider continuation；交互 app 按现有机制补齐未完成的外层 tool result。内部事件关联 execution ID 和 child call ID，关闭后的回调不得追加数据、重绘新 turn 或改变终态。Headless 复用同一清理机制，不等待 stdin。

### 7. 本地审计与 provider 协议分离

外层保留唯一普通 `run_code` tool call/result 对，结果包含脚本返回值、有界日志和执行摘要；失败时给出错误 code、阶段、可用的脚本位置和已完成/失败调用数量。脚本显式选择返回文件内容时仍允许，但受最终结果预算约束，不能保证模型永远看不到中间数据。

外层结果统一使用 `status`（`succeeded`、`failed` 或 `cancelled`）、`result`（失败时为 null）、`logs`、`logs_truncated`、`summary` 和 `error`。summary 包含内部调用的 attempted/completed/failed/cancelled 计数和耗时；error 为 null 或包含稳定 code、message、phase 和可用的 script line/column。阶段限定为 compile、runtime、tool、serialize；最终返回值预算不包含已单独受限的日志。该结构序列化为普通外层 tool result，不另增 provider 协议类型；turn 已取消时仍优先遵守既有中断收尾，不等待 guest 返回 cancelled 对象。

内部调用使用新增本地 `code_execution` transcript role，事件包括执行开始、子调用开始/结束与执行终态；关联外层 call ID、execution ID、递增事件序号和子调用序号。每条事件只存有界工具名、参数摘要、状态、计数、耗时及错误摘要，不复制文件正文、完整数据 envelope 或 guest 对象。审计摘要总计最多 32 KiB，并预留子调用及执行终态空间。

该 role 在 JSONL 读写、恢复、分叉、清理和预览路径中可识别；所有 provider converter、token 统计、引用给模型的会话投影和压缩输入均过滤该 role。不得把内部事件伪装成没有 provider call 的普通 `tool_result`。TUI 在外层调用下展示按调用序号组织的子项和进度，宽度、颜色、resize 及清理仍复用既有终端机制，不新增 alternate screen。

审计回调仅更新有界分组事实，并按真实外层 call ID 将进度注入可重绘的 footer；单工具 pending 也保留该身份，不能猜测最近执行。运行中不向稳定历史写入 start、call_start、call_end 或 end 的进度行。审计结束而外层结果未到时 footer 显示 finishing，收到实际外层 tool_result 后只追加一个完整最终块：终态标题、按子调用序号组织的结果、一份计数摘要及结果预览。成功审计的通用结束诊断不重复计数。重复事件及重复外层结果不再追加块或分隔。

所有阶段复用 Bash 的 `renderToolRailRows`。执行标题/状态沿用普通工具配色，进度保持正常亮度；Result/Logs 标签与正文均使用 Bash 的 toolOutput 弱化色，不再额外叠加 ANSI dim，Error 标签与错误正文使用正常亮度的 toolError，耗时和辅助说明独立弱化。最终和非活动历史恢复块以一行空白与后续消息分隔，工具对独立投影沿用相同约定。

下段从真实外层 `tool_result` 展示 `Result:`、非空 `Logs:` 和非 null 的 `Error:`；空日志显示 `Logs: (none)`。不展开源码或所有中间响应；显式返回的正文属于最终结果，可以在此预览。各字段按 JSON 格式化，C0/C1/DEL 转义为字面量而非执行或删除，原始 provider 响应和持久化事实不变。

每节缓存最多 12 个逻辑行且 4096 个字符的展示文本，绘制时正文再限为 12 个物理行；独立标注 `preview truncated for display; agent response unchanged`。真实 `logs_truncated` 另行说明，返回值内部的 `has_more`/`truncated` 只按原值展示，不据此推断 UI 或日志截断。预览不缓存原始 JSON/结果对象，旧记录在格式化前校验 JSON 复杂度；非活动恢复中缺失或畸形外层响应显示预览不可用，不伪造 null 或空日志。活动 resize 先重建当前窗口的分组事实再绘制 footer，不能将等待外层结果的运行提前提交历史；非活动未完成历史才显示 interrupted/unfinished。恢复不重执行，窗口缓存分离，逐出时释放预览。极窄 rail 须为宽字符保留正文空间，无法容纳的字形安全省略。

内部真实执行复用已有 tool lifecycle 观测，附加 execution/parent-call/child-call 归因，开始与结束事件各最多一次；拒绝、失败和取消均可区分。模型只看到外层 continuation。Headless 仅发送观测/hooks，不持久化会话或写 TUI 输出；debug 仍须脱敏和有界。

### 8. 评估先于推广

模型评估单独运行，不放入需要真实 API 的默认 `npm test`。固定模型版本、推理配置、工具限额、项目 fixture 和验收器，比较“原生工具”与“原生工具 + 可选 run_code”，另设强制 Code Mode 作为诊断组而非用户默认行为。

任务至少覆盖单次简单查询、跨文件筛选、依赖分支、聚合、无匹配、空/部分失败、分页截断及脚本错误修复；使用临时目录和结果断言，不能以模型自报成功计分。记录实际是否选择脚本，脚本首次成功率与任务最终成功率分开，修复/重试成本计入总 token、耗时与工具次数。只读任务的写文件、网络或越权尝试单列，任何实际越权都阻止发布。未训练模型的结果不能外推到其他模型。

备选“根据模型名自动开启”缺乏证据，不采用。无论评估结果如何，本变更仍默认关闭；证据不足或最终成功率/成本明显恶化时保留实验性质，不宣传普遍收益。

## Risks / Trade-offs

- [专项训练不足导致更多脚本修复] → 保留原生工具、短契约和小示例，配对报告包含完整失败与修复成本。
- [引擎或 host bridge 漏洞] → JSON-only 边界、无宿主引用、父进程预算、恶意样例测试、隔离不可用即拒绝；不声称消除所有漏洞。
- [只读工具仍能读取敏感内容] → 不扩张现有路径能力、不注入凭据；文件内容始终视为不可信数据，不因内容提示新增权限。
- [复杂数据处理绕过预算] → 同时限制 guest 活跃计算、消息大小、宿主采集、最终 JSON 与日志，测试超大字符串和深层对象。
- [调用完成顺序导致记录不稳定] → 调用序号与事件序号分开，稳定 UI 排序，终态只提交一次。
- [文本与结构化结果漂移] → 共用采集源，契约 schema/说明/真实结果一致性测试，原生输出回归。
- [依赖增加安装体积或不适配 CommonJS] → 先完成兼容验证，纳入 npm pack 安装冒烟；不引入打包器解决兼容性。
- [未来接入写操作后重试产生副作用] → 本变更明确排除写操作；后续必须单独设计逐调用审批、变更记录和非幂等恢复，不能修改白名单就直接上线。

## Migration Plan

1. 先验证隔离引擎与跨平台构建，不满足安全和加载条件则停止执行器实现，记录阻塞项。
2. 补齐三个本地工具的数据契约与取消能力，保持原生调用回归通过。
3. 接入默认关闭的 `/config` 常规开关、工具、策略桥接、审计、provider 过滤和 headless 清理。
4. 完成自动化安全/功能回归及人工 TUI 检查，再在显式开启配置下运行模型评估。
5. 回滚时关闭 `tools.codeMode.enabled` 即停止新增执行，保留历史读取能力；运行中脚本按捕获的 snapshot 完成或由用户中断，不通过热改配置静默杀死。

## Open Questions

- 具体 QuickJS/WASM 包、版本及 Node >= 20.3 的 WASM 分发方式，必须由实施前验证确定；不授权替换为较弱隔离。
- 32 MiB guest 堆、1 秒计算、30 秒墙钟等是本提案的首轮固定预算，需用真实本地分析任务验证是否过严；更改时同步更新规格与测试。
- 真实模型评估使用哪些已配置模型、任务数量和重复次数，实施时与用户确认预算；自动化 fixture 和原始指标定义不依赖该选择。
