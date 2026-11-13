## Context

现有 `run_bash_command` 仅接受 `command`，通过共享 runner 等待子进程关闭后返回一次工具结果。runner 使用非交互 stdin、stdout/stderr pipe、POSIX 进程组、可选超时与 turn abort。工具输出超过预算后才创建 offload 文件，临时文件在执行结束时发布，不能直接充当运行期间可读的任务日志。

app 以 turn 身份隔离异步回调，工具 registry 在运行准备时创建。后台进程需要跨 turn 存活，因此不能由某一轮 registry 或 turn controller 独占。现有 `read_files` 已能读取绝对路径的 UTF-8 文本，并提供有界输出与 offset/limit 分页。

## Goals / Non-Goals

**Goals:**

- 模型启动长时间命令后继续工作，通过现有 `read_files` 查询日志与确定的执行状态。
- 不增加 provider-visible 工具名称；保留前台 Bash 行为、审批与沙箱。
- 为用户提供任务列表、日志查看、停止和退出清理；管理进程生命周期与跨轮 undo 保护。

**Non-Goals:**

- 自动把慢命令转后台、运行中快捷键转后台、模型查询/停止专用工具。
- PTY、stdin 交互、shell/shell-local 后台化、后台子 Agent、headless 后台运行。
- 完成后自动调用模型、自动注入 provider 消息、固定轮询、就绪检测或服务健康检查。
- daemon、跨应用退出保活、从历史记录恢复进程控制、跨进程任务接管。
- 第一版底栏后台任务数量投影，以及 transcript 中后台任务的运行态刷新显示。

## Decisions

### 1. 只扩展现有 Bash 参数

`run_bash_command` 增加可选 `background: boolean`，默认 false。为 true 时完成权限检查、创建文件并成功启动子进程后返回一次启动结果，文本仅包含 `state`、`output_path`、`status_path` 和 `read_files` 查询指引，不包含 stdout/stderr 正文。结构化 `tool_result.details` 保存同一任务引用，至少包含 task_id、session_id、owner_instance_id、output_path、status_path；身份使用三元组 (session_id, owner_instance_id, task_id)，避免不同实例的短 ID 冲突。`ok: true` 仅代表启动成功；不填造成功 exit code。快速退出的命令允许启动结果已经报告其实际终态。

工具 description 和返回指引明确：仅在无需即时输出、能够先继续其他工作时使用 background；需要立即根据结果决定下一步的命令使用前台执行。后台启动后文件可能仍为空，不能因空日志推断成功或失败，也不应立即进入反复轮询。

前台调用继续等待完成。配置中的 `timeoutMs` 对后台任务仍是从进程启动起计算的硬执行期限，不是转后台的时间窗口。所有后台启动调用在现有并发分类器中归为 exclusive；现有 executor 已等待 execute() resolve，后台 handler 在交接后 resolve 即可自然释放屏障，不修改调度器、不引入新的释放机制。

备选的三个管理工具或一个多 action 工具都不采用：查询直接复用文件读取，用户停止通过本地命令完成，第一版没有模型专用停止入口。

### 2. app 持有任务管理器，runner 共享底层进程执行

新增职责单一的后台 Bash 管理器，由交互式 app 创建，经 agent setup/registry 注入当前主运行。管理器持有任务 Map、独立 AbortController、进程句柄、日志写入器和最终结果；每条任务捕获创建时的 cwd、session ID、应用实例 ID、call ID 和沙箱上下文。

runner 的进程启动、输出采集和终止逻辑应复用；保留 `runBashCommand` 的等待式接口，按实际需要抽出可持有运行句柄的底层能力。后台句柄不依赖创建它的 turn 对象，也不使用无限内存缓冲。

启动采用明确交接边界：注册并返回任务引用之前发生的 abort 必须停止待交接进程；交接后，turn abort 仅取消当前推理，不取消该后台任务。所有收尾路径幂等，spawn/close/error/stop 的竞争只产生一次终态。不能用 `Promise.race` 提前返回而丢弃进程管理，也不能把命令拼成 `... &` 后不再持有句柄。

### 3. 日志和状态文件是查询协议

目录使用现有用户级 cwd 项目分区：

```text
~/.echo/echo_tui/projects/<project-key>/background-tasks/
  <session-id>/<instance-id>/<task-id>/
    output.log
    status.json
```

文件路径由运行时生成，不接受模型指定。目录权限 0700、文件权限 0600。日志在 spawn 前建立，启动结果返回时两个路径都必须可读取，不等待执行结束才 rename 发布日志。

`output.log` 追加 stdout/stderr 按运行时到达顺序合并的 UTF-8 文本；不承诺两个系统流之间的全局原始顺序。按流维护解码器，移除不适合文本读取的控制字符；把解码产生或原文含有的 U+FFFD 转为可见字面文本 `\uFFFD`，移除 NUL，保证已有 `read_files` 不因这两种字符拒绝整个日志。规范化之后，每个物理行最多 4096 UTF-8 字节，超出前在码点边界插入换行；按单行计数而不积累整行，跨 chunk 仍执行同一限制。终端显示继续使用现有安全文本处理。日志不回卷、不轮转，行号可用于分页；这是供模型阅读的规范化日志，不承诺字节级原始输出。

`status.json` 为版本化、短小的 JSON 快照，由运行时使用同目录临时文件加原子替换维护，至少包含：

```json
{
  "version": 1,
  "task_id": "bash-12",
  "session_id": "...",
  "owner_instance_id": "...",
  "command": "npm test",
  "cwd": "/workspace/project",
  "state": "running",
  "started_at": "2026-11-11T08:00:00.000Z",
  "finished_at": null,
  "exit_code": null,
  "signal": null,
  "reason": null,
  "output_path": ".../output.log",
  "output_truncated": false
}
```

状态仅为 `running`、`stopping`、`exited`、`stopped`、`failed`。自然退出使用 `exited` 并保存真实 exit code，非零仍为命令失败；用户停止、超时、日志上限、会话清理在确认进程结束后使用 `stopped` 并保存原因；spawn 或运行时 I/O 故障使用 `failed`。有界清理超时且无法确认进程结束时，关闭本地输出采集，发布 `failed`、`reason: cleanup_timeout`、`exit_code: null`，明确结果未知，不报告 stopped 或成功。`stopping` 不等于已结束。历史“未托管”是 UI 对引用的分类，不新增持久化进程状态。

终态发布前排空已接收日志、刷新解码器并关闭写入器；看到终态后读取的日志不再因该任务正常写入而增长。状态写入失败时停止任务、向 UI 报告运行时故障，不继续让旧 running 文件冒充可用查询协议；历史旧快照不得当成重新确认的进程事实。

模型先读状态，再按需读日志，可用 `offset`/`limit` 分页。运行中读到 EOF 只代表读到当前文件末尾；末行可能继续增长，后续增量读取需重读上一页最后一行。第一版不增加 cursor、tail 或等待参数，也不修改通用 read_files 协议。

### 4. 有界资源与启动失败

每个活动会话最多同时运行 16 个后台任务；这是长驻进程资源限制，不改变现有连续只读工具段的并发规则。每个任务日志上限 8 MiB，内存仅保留用于 UI 的有界尾部。超过日志上限时停止任务，状态写入 `reason: output_limit` 和 `output_truncated: true`；不得悄悄丢弃输出后声称日志完整。上限第一版作为具名常量，不增加配置面板。

文件准备失败、进程启动失败或超过并发限制时返回匹配 call ID 的失败结果，不留下未托管运行进程。运行中磁盘故障也触发停止。已完成文件保留供当前会话和历史读取，启动本功能不删除其他会话日志；历史文件总量回收后续单独设计。

### 5. 本地 UI 管理与 transcript 投影，完成通知不触发推理

`/tasks` 通过 CommandHost 的后台任务领域端口读取合并投影：当前会话的管理器条目 ∪ 当前 session transcript 中 `tool_result.details` 的合法后台任务引用。引用按拥有者 session_id 过滤，按上述三元组去重；存在当前实例句柄时以内存条目为准，只存在引用时为只读历史条目。引用投影覆盖整个 session journal 的有效记录，不仅是 provider 活跃窗口；会话加载时恢复，记录追加和 undo 截断时同步更新，避免 compaction 后丢失来源。无需新增持久化任务索引或扩展 ChangeCheckpoint。fork 复制的源 session 引用保留为普通历史文本，但不计入新 session 的 /tasks 列表。

仅有历史引用的任务可查看状态与日志，不能停止；文件缺失、格式不合法或身份不匹配时显示不可读取，不作为进程状态依据。内存 Map 不负责凭空恢复历史数据。已有 Bash journal 校验对 details.kind 为 bash 无条件放行，不需要新增校验分支；对新增字段的形状检查放在消费任务引用的投影边界。

列表与详情采用两级结构，文案使用中文，输出由既有 ANSI 重绘负责，不切换 alternate screen。列表每行一条任务，由状态标记、压成单行并按宽度截断的命令摘要和快照耗时组成；运行中与历史未托管使用不同标记，未托管条目不得显示为运行中；空会话显示中文空态。详情展示命令、状态、耗时、终态退出码或停止原因、日志路径与有界日志尾部。`r` 刷新当前视图；停止走既有 confirm surface 二次确认，并在确认后重新按任务身份查找句柄，句柄已不存在时刷新为历史条目而不是报错，`s` 只在受管运行任务上可用。Esc 从详情返回列表，列表内 Esc 关闭 surface。进入列表/详情时各取一次快照，停止操作完成后重新取快照；不接入 activity tick，不启动自动日志轮询，也不为任务 surface 做每秒全量 footer 重绘。

第一版 `/tasks` 遵循现有命令排队规则，不开放响应期命令；模型回复期间可继续输入并排队，任务管理不会另开一套输入处理。

transcript 投影只陈述已落盘的启动事实，不陈述运行态。`tool_result.details` 带合法后台任务引用时，bash call/result 对改走后台专属紧凑投影：标题标明后台执行，不展示内部编号，正文只显示命令摘要和日志文件短名，不渲染项目分区的完整绝对路径，避免长路径在窄终端下占满多行 rail；完整路径只出现在模型可见的工具文本和 `/tasks` 详情中。该投影不解析启动结果文本的 stdout/stderr 分段，不把启动成功渲染成 complete 或 exit 0，也不读取管理器句柄，保证实时渲染与历史重放走同一条路径。

历史重放按引用状态降级。引用合法但当前实例没有句柄时，transcript 投影仍只显示启动事实，`/tasks` 详情显示“未托管，执行结果未知”或已落盘终态；引用缺失、格式不合法或文件不可读时显示不可读取。旧版本结果缺少后台任务字段时继续按原前台结果解析和渲染，不改变既有投影。

第一版不在底栏展示后台任务数量，也不为 transcript 中已启动任务增加运行态刷新；状态行保持原有 model/project/mode/key hint 组成，任务生命周期变化只更新完成通知和 `/tasks` 投影。

每个任务终态最多追加一次有界 `local_notice` 并触发重绘，不打开/抢占 surface、不打断输入、不调用 provider。模型获知结果的正式渠道始终是工具启动结果中的路径和后续 `read_files`。不得给原 call ID 追加第二个 tool result。通知遵守当前会话身份与退出状态，清理期间不把旧任务的回调写进新会话。

通知的追加时机由单一的本地通知端口裁定，而不是由每个异步回调自行决定。子进程退出是任意时刻事件，响应占用期间只入队；判据是现有响应锁，因此 assistant turn、shell 执行与手动压缩同一口径。响应结束、下一条消息派发之前统一追加，不会切断正文，也不会插在 `tool_call` 与 `tool_result` 之间；因为不在轮次中途写记录，也不需要与 agent loop 的记录区间同步。队列按会话身份归属，切换会话后旧条目直接丢弃；通知正文完整保留，不做聚合折叠，错误原因不能只留在队列里而被折叠掉。provider 重试、中断提示与命令侧提示本身有明确提交位置，仍走各自原路径。

用户可见任务面板与完成通知以命令识别任务，不单独展示 task ID；完成通知的命令摘要规范化为单行并限制到 160 UTF-8 字节，截断时加省略号。内部 ID 仍服务管理器、文件路径、结构化引用、停止与 undo，不改变模型工具协议。

### 6. 进程只属于当前会话和当前应用实例

- 最终回复结束及交接后的 Esc：后台任务继续运行。
- `/clear`、成功 `/resume` 或成功 `/fork` 切换会话：停止离开会话的运行任务，完成清理后交接新身份；新分支只继承 transcript 文件引用，不继承进程控制。取消或失败的切换保持原任务运行。
- 正常退出/Ctrl+C/Ctrl+D：停止后台任务并关闭文件后完成既有终端清理，清理等待有界。
- 终止采用现有 POSIX 进程组 SIGTERM 后 SIGKILL 策略；Windows 沿用平台能力并明确其子进程树清理限制。
- 历史恢复不重新启动、接管或根据落盘 PID 杀死进程。文件中的旧 running 状态仅是所属实例最后快照；UI 对没有当前实例句柄的历史任务显示“未托管，执行结果未知”，不得显示为当前活动任务。它也可能仍由另一应用实例持有，因此不能仅因当前实例没有句柄就改写它的文件。

第一版不承诺 SIGKILL、系统断电等非正常退出的进程清理；不引入外部 watcher。文档必须区分“受控后台任务”和脱离监督的历史状态。

现有 main.ts 的 exit() 先调用同步 shutdown() 再立即 process.exit()，无法等待 pipe 收尾。本次明确改为异步、幂等的 shutdown(): Promise<void>，多个退出请求共享同一在途 Promise。开始时同步阻止新输入/任务、取消当前前台操作并隔离所有 UI 回调；随后并发停止后台任务，复用 500ms TERM 宽限，整个任务集合共享最多 2 秒清理期限，到期发送 KILL 并关闭本地采集，未知状态按 cleanup_timeout 处理；finally 恢复终端。exit() 等待 shutdown 后才 process.exit()，不得阻塞同步忙等。

Ctrl+C、Ctrl+D、/exit 及输入/surface 的 void 退出回调可保留签名，通过一个接管异常的 void 包装器启动异步 exit 流程。自动更新同样使用 shutdown：AutoUpdateController 的 shutdown 端口改为可等待，并在启动更新子进程/交还终端前 await，不得留下另一条提前 process.exit 路径。以组合测试验证顺序及重复退出，无需为了后台任务重构无关控制器。

### 7. 执行边界和 undo

“是否注入后台任务管理器能力”是后台启动可用性的唯一运行时判据：有能力才允许进入原命令权限判定，无能力在执行与审批前返回不支持后台运行。能力只由交互式主会话装配并注入；headless（包括 full-access）、子 Agent、BTW/readonly 各自准备运行时不传入该能力。子运行重建 registry 时不得隐式继承。loop 与 handler 共享同一可选能力，不另行嗅探 executionMode、conversationKind 或 toolPolicy 复制一套资格判定。provider schema 始终相同。plan 主会话有管理器，仍按当前只读分类和生效沙箱判定原始 command，后续模式切换不会提升已启动进程权限。

不通过额外 shell 重定向实现文件输出：由父进程在沙箱外采集输出并写任务文件，子命令保持原始沙箱约束。模型工具名单禁用 `run_bash_command` 时仍完全禁止启动，后台开关不会恢复工具。

文件权限仅隔离其他系统用户，不能阻止同 UID 且具有该目录写权限的子进程篡改任务文件；例如 cwd 覆盖 ~/.echo 且沙箱允许该目录写入时，status.json 可能被伪造。管理器持有的句柄与内存状态是停止、活动计数和 undo 保护的唯一权威，禁止按文件内容释放保护或执行 PID 操作。模型读取的状态/日志与其他本地文件一样属于非可信输入，不作为权限依据；本次不宣称文件协议具有防篡改保证。

不可追踪写入命令启动时按既有规则使本轮 checkpoint 失效。跨轮保护分两处落地：管理器暴露当前 session 是否有尚未确认结束的可能写任务；history-command-ports.ts 的 getSummary() 先查该状态，AppContext.executeUndo() 在任何文件恢复前再次查该状态，覆盖确认期间状态变化与绕过 UI 的调用。没有 recording checkpoint 的两轮之间也必须阻止 undo，不能依赖 ChangeHistoryContext.invalidate()，更不能只在完成通知中调用它。新轮 beginCheckpoint 后立即查询活动写任务，必要时 invalidate 刚创建的 checkpoint；任务在轮内结束也不恢复该 checkpoint。cleanup_timeout 等未知执行结果保留当前会话写入保护，不能按文件中的状态自行释放。

判定“可能写入”复用实际 read-only 沙箱与现有只读命令规则。只读任务不触发该写入保护。undo 需要清理任务时，使用选中 checkpoint.transcriptStartIndex 到当前记录尾部的待截断区间，提取该区间 tool_result.details 的合法任务引用，匹配当前管理器句柄并先停止仍在运行的只读任务，无需给 ChangeCheckpoint 增加 task ID。清理异步完成后再次核验当前 session、checkpoint ID 和活动写任务状态，才执行现有同步文件恢复与 transcript 截断；清理失败则保留记录并返回失败，成功停止但文件恢复失败时记录仍保留，任务维持真实停止状态。CommandHost undo 执行端口和命令处理链明确改为可等待，不在同步 executeUndo 中丢弃 Promise。

## Risks / Trade-offs

- [模型可能反复查询文件] → 在启动结果和工具说明中说明按需读取，运行时不添加固定模型轮询或自动唤醒。
- [日志和 JSON 不是事务性双文件] → 终态状态在日志收尾后发布；运行中允许读取较旧快照，但不允许读取半个 JSON。
- [文件方式不提供模型停止入口] → 第一版由用户 `/tasks` 停止，不向模型暴露 PID 管理协议。
- [后台写入跨轮影响 undo] → 用会话级活动写任务保护覆盖全部重叠 checkpoint，恢复历史时继续保留失效边界。
- [退出或切换阻塞] → TERM/KILL 分阶段、有界等待和幂等收尾；迟到 callback 只能作用于原任务。
- [逃离进程组、强制崩溃或多实例历史快照] → 不承诺持久进程托管，不将旧 running 文件视作当前活跃事实，不按历史 PID 接管。
- [历史任务日志长期累计] → 单任务 8 MiB 上限，第一版保留文件；总量清理由后续独立变更处理，避免本次误删历史引用。

## Migration Plan

本次增加可选参数和独立 sidecar，不迁移旧 session。历史 Bash 结果缺少任务字段时继续按前台结果解析和渲染。实现时先接入运行管理和文件协议，再接工具、生命周期和 UI，最后补齐回归验证。回退实现后历史文件保留为普通文件，原有 read_files 仍能读取。

## Open Questions

无阻塞问题。自动唤醒、模型停止入口、无人值守后台执行与历史日志总量清理均不属于第一版验收范围。
