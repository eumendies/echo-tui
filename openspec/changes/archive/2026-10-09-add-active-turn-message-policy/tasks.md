## 1. 配置与运行策略

- [x] 1.1 在常规设置增加 `ui.activeTurnMessagePolicy` 的 `pending | steer` 归一化、默认值、草稿校验和增量持久化，测试旧配置与非法值回退及未知字段保留。
- [x] 1.2 在 `/config` → 常规增加“响应期间发送消息”的中文选择与工具等待说明，测试显式保存、dirty fingerprint 和取消草稿。
- [x] 1.3 在配置 snapshot 和主 assistant turn 生命周期固定策略，测试 watcher/保存只影响下一轮，BTW、子代理、shell 和 headless 不变。

## 2. 有界输入与提交所有权

- [x] 2.1 扩展共享待处理单槽的消息身份、目标 turn、pending/steer 类型和准备/等待/失败状态，测试容量、移除和迟到准备结果隔离。
- [x] 2.2 抽取有实际复用目的的普通 user record 素材准备逻辑，保持 slash、skill、shell 路由；素材成功后才通知抢占，准备失败保留原文与可移除卡片。
- [x] 2.3 在 provider-neutral agent 输入协议提供最小运行中消息端口，建立 app transcript、journal 与 runtime `recordRegion` 的唯一同步提交边界，不重置 turn 或 live composer。
- [x] 2.4 实现目标 turn 先结束时向 idle dispatcher 的唯一移交，复用已准备素材；测试不重复展开附件、不重复输入历史和不丢失败准备状态。

## 3. 模型请求抢占与草稿隔离

- [x] 3.1 为普通模型请求增加独立请求级取消并联动父 turn 信号，保证工具、审批、压缩和子代理只接收原 turn-level 取消。
- [x] 3.2 在 loop 中区分引导抢占、真实错误与 turn 取消；旧请求收尾后继续同一运行，不触发 onComplete、response lock 释放或用户中断提示。
- [x] 3.3 增加请求步骤 identity，抢占时立即隔离旧 token、reasoning、retry 和完成回调；测试同 turn 内迟到事件与 listener 清理。
- [x] 3.4 验证 OpenAI Responses、OpenAI Chat、Anthropic 的请求建立、流读取和可中断退避能够正确取消，不由 adapter 重试被抢占请求。
- [x] 3.5 将抢占边界的正文保存为普通 assistant 记录，本地保留可读推理草稿与已完成 summary；验证三个 converter 不发送未完成私有记录或半截参数，并只记录权威 usage。

## 4. 工具安全边界与自动压缩

- [x] 4.1 在 provider 返回、下一工具启动和 continuation 构建前处理就绪输入，等待单个已启动工具的真实结果，不发出引导性工具取消。
- [x] 4.2 在已启动并行只读组收尾后应用引导，保持原始结果顺序，不启动后续组；测试多工具完成顺序与重复结果防护。
- [x] 4.3 为完整 provider response 声明但未启动的调用生成明确“跳过且未执行”的失败结果，按原 call ID 成对提交并置于新 user record 之前。
- [x] 4.4 用三个 provider 的真实转换契约验证已显示及未显示的调用均无孤儿记录、已完成调用不重复；半截响应中的调用不执行。
- [x] 4.5 自动压缩期间保留输入，摘要完成后应用引导并重查预算；测试 app/runtime 记录顺序、activeStartIndex 和后续压缩一致性。
- [x] 4.6 验证 `run_subagent` 等待采用相同安全收尾，不广播或抢占子代理；已有 Esc 的 best-effort 取消继续有效。

## 5. 终态竞态、交互与持久化

- [x] 5.1 在最终 assistant/onComplete 提交边界仲裁就绪输入，覆盖 final 前就绪、final 先完成、prepare 跨终态和真实错误后的唯一移交。
- [x] 5.2 接入引导卡片的准备、就绪和失败投影，仅显示预览、移除与准备提示，不上报执行阶段或展示等待原因；保持单行宽度截断、固定高度和既有 footer 预算。
- [x] 5.3 保持高优先级 surface 与 Esc 移除顺序，测试通知抢占后提交前移除会继续原任务，已应用消息后的 Esc 仍取消整个 turn。
- [x] 5.4 在 `/clear`、成功 `/resume` 和退出时清理 transient 消息并隔离旧回调，测试完整引导记录的 journal 顺序与恢复不重发。
- [x] 5.5 使用真实提交控制器、运行端口和适当 fake provider fixture 覆盖单槽、连续引导、live composer 文本/光标及旧 finally 隔离，不增加仅为测试服务的生产分支。

## 6. 文档与回归验证

- [x] 6.1 更新用户配置和交互文档，明确默认 pending、下一轮生效、工具可能等待、正文按 Esc 保留且私有协议草稿不持久化，以及即时引导不等于撤销或紧急停止。
- [x] 6.2 完成实现后按顺序运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`，修复失败项。
- [x] 6.3 通过 `npm start` 定向验证两种策略、真实/假流式请求、工具/审批/提问、连续提交、Esc、输入编辑和 Ctrl+J、footer/resize、slash/skill、恢复和终端清理。（用户于 2026-10-09 确认已完成手验。）
- [x] 6.4 验证 `--once` 的非 TTY、默认工具拒绝、显式 `--full-access` 和 provider 失败退出行为不受新策略影响，并确认不使用 alternate screen。

## 7. 按每次提交的模式执行

- [x] 7.1 移除 turn 启动模式字段/参数；普通 user record 捕获当前选择，素材准备和移交不得覆盖该选择。
- [x] 7.2 在引导应用边界更新模式说明、风险分类、模式派生沙箱、后续委派及用量；保留显式 readonly 策略，不添加跨 mode 排队判断。
- [x] 7.3 增加 normal/plan 双向引导、准备/移除、素材移交与显式限制回归；响应期 Tab 允许选择后续提交模式，其他锁与 surface 不变；更新文档并按顺序完成全套验证。

## 8. 抢占正文保留与 Esc 对齐

- [x] 8.1 冻结累计正文与未发布的可读推理，等 SDK 收尾后先本地 summary、再普通正文、再引导；完整结果优先，保持父级取消与真实错误归属。
- [x] 8.2 覆盖连续引导、已发布 summary 去重、三个 provider 请求转换、引导移除和紧接 Esc、完整响应竞态、journal 恢复及终端稳定前缀；不增加未完成标记或消息类型。
- [x] 8.3 同步规范和用户文档，按顺序完成类型、全套测试、语法和规范检查，运行 pending/steer 的实际启动冒烟；真实 TTY 限制仍单列于 6.3。

## 9. 删除长指令人工回退

- [x] 9.1 仅移除同轮用户指令过长的人工回退及专用投影字段，保留 4000 字符头尾截断、16000 总预算和其他审批回退。
- [x] 9.2 更新投影与实际 reviewer/resolver 组合测试，验证长引导仍调用模型、yes 一次允许和 no 保留人工回退；同步文档并按顺序完成全套验证。

## 本次验证记录

- 自审五项修复完成：自动审批纳入已应用引导原文并隔离文件授权；收窄素材准备 catch；删除旧 claim/export/import；合并完整响应提交；统一卡片宽度与 Esc 提示优先级。此前增加的长指令转人工处理，已在第 9 节按用户要求撤除；现有截断策略不变。
- 修复后顺序验证：`npm run typecheck` → `npm test` → JavaScript 语法检查，全部通过。全套 2014 通过、29 跳过、0 失败（新增 10 项回归，强化既有问答与工具记录顺序断言）。
- 按提交模式执行的顺序验证全部通过：全套 2032 通过、29 跳过、0 失败（新增 18 项模式回归）。首轮已修正既有 command metadata 断言；一次独立 glob 预算用例失败在单独及后续全套重跑中通过，未修改无关 glob 实现或测试。
- 模式转换接口简化：共享函数直接接收 `InteractionMode` 并内部归一化，历史查询返回原始 mode，移除外部转换函数。新增四种 mode 的全部 16 种组合回归；顺序验证全套 2048 通过、29 跳过、0 失败，类型、语法和规范检查通过，行为不变。
- 移除展示用的阶段上报接口、类型、字段及调用；引导卡片仅保留消息预览、Esc 移除和准备中/失败提示，不显示等待原因。阶段断言改为验证工具安全边界，新增紧凑/双行卡片的实际文本回归。顺序验证全套 2047 通过、29 跳过、0 失败，类型、语法和规范检查通过；首轮仅既有 glob 预算用例失败，单独及完整重跑均通过，未修改无关代码。
- 抢占正文保留与 Esc 对齐：SDK 收尾后正文作为普通 assistant 保存、本地推理作为 summary 保存，无未完成标记；完整结果优先，迟到回调继续隔离，预览不提前切到 thinking。新增 13 项回归，针对性 216/216 通过；最新顺序验证全套 2060 通过、29 跳过、0 失败，类型、语法和规范检查通过。补充预览断言后的复验曾遇到既有 glob 预算用例失败，单独及后续完整顺序重跑均通过，未修改无关代码。
- 仅重命名请求抢占与引导生效方法并澄清注释，行为不变；相关单槽与请求状态命名只读检查，其他建议未实施。顺序验证全套 2060 通过、29 跳过、0 失败，类型、语法、规范及 diff 检查通过。
- 仅删除长指令强制人工回退及专用字段，截断与其他回退保持不变；新增 reviewer/resolver 组合的 yes/no 回归。顺序验证全套 2061 通过、29 跳过、0 失败，类型、语法、规范及 diff 检查通过；日志 `/tmp/echo-approval-remove-length-fallback-test.log`。真实 TTY 验证仍保留于 6.3。
- `openspec validate add-active-turn-message-policy --strict` 和 `git diff --check` 通过。
- 独立临时 HOME 下运行实际 `--once` CLI：假模型非 TTY 输出、默认工具拒绝、显式 `--full-access`、provider/config 错误退出码均通过，未创建 session。
- 独立临时 HOME 下运行实际 `npm start` 的管道冒烟：pending/steer、Ctrl+J、响应期 `/status`、连续提交、journal/checkpoint 顺序、Ctrl+D 与无 alternate screen 均通过。
- 模式变更后的实际 `npm start` 管道冒烟：pending/steer 各通过 Tab normal→plan、提交后再选 shell、消息 mode 保持 plan、模式说明与 journal/checkpoint 顺序、Ctrl+J、`/status`、Ctrl+D 和无 alternate screen。使用假模型真实流式 echo；模式说明使输出更长，脚本等待完整响应后才退出。
- 移除阶段上报后的实际 `npm start` 管道冒烟：pending/steer 均通过上述流程，额外确认引导显示通用卡片且不含等待原因；普通排队展示不变。
- 正文保留后的实际 `npm start` 管道冒烟：pending/steer 均在已开始流式输出时提交第二条消息，验证普通 assistant 正文、顺序、无标记、journal/checkpoint、Ctrl+J、输入编辑、`/status`、Ctrl+D 和无 alternate screen；pending 保存完整首段，steer 保存首段的 17 字符前缀再追加新 user，未产生任务中断通知。独立临时 HOME，日志与脚本均在 `/tmp`。
- 6.3 此前受助手环境限制：无法分配 PTY（此前 `out of pty devices`，重试返回 `Operation not permitted`），管道冒烟不等于真实 raw-mode/视觉交互手验。用户于 2026-10-09 确认已完成手工验证，并要求标记完成后继续同步规范及归档；本项按用户确认完成，而非助手补做 TTY 验证。
