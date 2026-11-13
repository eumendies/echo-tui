## 1. 后台运行与文件协议

- [x] 1.1 定义后台任务身份、状态快照、启动引用和管理器接口；为新增结构字段添加中文领域说明。
- [x] 1.2 从共享 Bash runner 提取可管理的运行句柄，保留前台等待接口，复用沙箱包装、进程组终止、超时与输出采集。
- [x] 1.3 实现 app 持有的任务管理器、独立停止控制和启动交接；处理交接前取消、交接后独立运行、快速退出及幂等收尾。
- [x] 1.4 实现项目/session/实例/任务分区文件，启动即发布 output.log；按流解码、移除 NUL、转义 U+FFFD，并在码点边界为超过 4096 字节的物理行插入换行；原子更新仅含五种状态的 status.json，终态在日志收尾后发布。
- [x] 1.5 实现 16 个活动任务上限、8 MiB 单任务日志上限、有界内存与 I/O 失败停止；不自动删除历史文件。
- [x] 1.6 增加 runner/管理器测试，覆盖双流中文、非法字节和原文 U+FFFD、跨 chunk 无换行长行分页、空输出、非零退出、快速结束、启动失败、JSON 并发读取、超时、日志/磁盘限制与停止竞争。

## 2. Bash 工具与模型查询

- [x] 2.1 为 run_bash_command 增加 background 可选布尔参数和严格参数校验，保持省略/false 时前台兼容；不新增工具名称。
- [x] 2.2 经 agent setup/registry 注入当前主会话管理器，将包含 session/instance/task 三元身份及路径的任务引用加入 tool_result.details 并验证持久化往返；已有 bash journal 校验不改动，引用形状在投影消费边界检查，兼容旧结果缺少任务字段。
- [x] 2.3 以是否注入管理器能力作为唯一后台可用性判据，缺失时在执行与审批前拒绝；验证 headless、子 Agent、BTW/readonly 不注入/继承，plan 主会话保留原命令审批和沙箱，禁用工具不得绕过。
- [x] 2.4 仅修改并发分类器使后台启动为 exclusive，并让 handler 交接后 resolve；复用 executor 现有等待语义，不修改调度器或前台只读并发分类。
- [x] 2.5 约束启动结果仅含任务元信息、路径和 read_files 指引，不含 stdout/stderr 正文；工具 description 保持原文，信息只挂在 background 参数上说明返回内容。
- [x] 2.6 增加真实工具 registry/agent 组合测试，验证后台启动后可继续工具调用、通过现有 read_files 读取状态/日志、审批拒绝无进程、工具数量不变和前台回归。

## 3. 会话生命周期与回退保护

- [x] 3.1 将管理器接入 app 生命周期，确保最终回复和交接后的 Esc 保留后台任务，目录及沙箱按启动时快照固定。
- [x] 3.2 接入 /clear、成功 /resume、成功 /fork 的离开清理，失败或取消切换不停止原任务；以会话/实例身份隔离迟到事件。
- [x] 3.3 将 main shutdown 改为共享在途 Promise 的异步幂等清理，任务集合共用 2 秒期限，exit 等待后再 process.exit；处理 cleanup_timeout 未知结果，finally 恢复终端；覆盖 Ctrl+C/Ctrl+D、/exit 和输入/surface 回调的异常接管。
- [x] 3.4 将 AutoUpdateController 的 shutdown 端口改为可等待，更新子进程启动前 await 同一清理，验证重复退出/更新交还顺序；历史恢复不接管进程或按落盘 PID 停止进程。
- [x] 3.5 增加管理器活动写任务查询，在 history command getSummary 和 AppContext.executeUndo 恢复文件前双重检查；新轮 beginCheckpoint 后立即使重叠 checkpoint 失效，未知终止结果保留保护，后续新轮仅在确认结束后恢复正常记录。
- [x] 3.6 从 checkpoint.transcriptStartIndex 起的待截断 tool_result.details 提取任务身份，先异步停止当前实例只读任务，再重新核验 session/checkpoint/写任务保护并执行原回退；将 undo 执行端口与调用链改为可等待，不扩展 ChangeCheckpoint。
- [x] 3.7 增加控制器测试，覆盖切换/fork 成败、多个退出入口和更新顺序、清理期限、两轮之间无 recording checkpoint 的 undo 拒绝、确认期间状态变化、只读任务清理失败和文件恢复失败。

## 4. 本地任务交互与通知

- [x] 4.1 经 CommandHost 合并管理器条目和整个 session journal 有效记录中的任务引用，按 session 过滤与三元身份去重；会话加载、记录追加/截断时更新投影，恢复仅有文件引用的只读历史条目，注册 /tasks 及普通响应期排队和帮助/补全。
- [x] 4.2 实现列表（状态标记、单行命令摘要、快照耗时）与详情（状态、耗时、终态退出码或停止原因、日志路径、有界日志尾部）两级 surface，含中文空态、历史未托管与文件不可读状态、r 手动刷新、停止二次确认和 Esc 逐级返回；不接入 activity tick，不自动轮询。
- [x] 4.3 为后台启动结果增加 transcript 专属紧凑投影：标题标明后台执行而不展示内部编号，正文只显示命令摘要和日志文件短名，不解析 stdout/stderr 分段、不渲染完整项目分区路径、不把启动成功渲染为 complete 或 exit 0；投影不依赖管理器句柄，历史重放与实时渲染同路径，旧结果保持原前台渲染。
- [x] 4.4 任务终态最多追加一次有界 local_notice；不抢占输入/surface、不追加第二个 tool result、不自动调用模型；第一版不增加底栏任务数量投影。
- [x] 4.5 增加命令和渲染投影测试，验证管理器为空时历史条目、compaction 后引用保留、同 ID 不同实例隔离、fork 源引用过滤、undo 引用截断、手动刷新、重复停止、通知去重、迟到事件隔离，以及后台结果紧凑投影与旧结果前台渲染回归。
- [x] 4.6 验证任务文件被改写为 exited 时，当前实例活动计数、停止与 undo 保护仍以内存句柄为准，不执行文件中的 PID 指令。

## 5. 文档与验收

- [x] 5.1 用户文档：run_bash_command 与 /tasks 属于模型侧与面板自述能力，不写进 README 的内部实现细节。
- [x] 5.2 按仓库顺序执行 npm run typecheck、npm test、find bin src test scripts -name '*.js' -exec node --check {} \;。
- [x] 5.3 使用 npm start 验证后台测试/失败命令/开发服务器、read_files 查询、/tasks 列表与详情查看停止、后台启动的 transcript 投影与历史重放、前台 Esc 与后台保活、退出清理、会话切换、跨轮 /undo 和主题/resize/footer 重绘。
- [x] 5.4 回归 headless --once（默认 deny 与 full-access）、子 Agent/BTW readonly 拒绝后台请求，确认前台执行与原审批行为不变。
- [x] 5.5 按 AGENTS.md 完成交互 TUI 回归检查，确认输入编辑、流式输出、Markdown/工具渲染、既有 slash commands 和审批/问题 surfaces 无回归。

- [x] 5.6 隐藏面板、停止确认、后台启动投影和完成通知中的独立任务编号，以命令识别任务；保留内部身份与模型工具协议，更新渲染和通知测试。
