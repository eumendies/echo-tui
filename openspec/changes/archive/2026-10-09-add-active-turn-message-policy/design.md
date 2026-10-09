## Context

现有 `ComposerSubmissionController` 在 active assistant turn 中将普通输入放入 `PendingMessageContext` 单槽；`dispatchPendingMessage()` 仅在 response lock 释放后通过普通提交路由启动下一轮。`TurnContext` 的 Esc 中断会取消整个运行、保存 partial、补齐已播报工具 pairs 并释放锁。

`agent-loop-runtime.ts` 持有从 `session.records` 复制的 `recordRegion`，通过 `provider → tools → provider` 循环推进。当前一个 turn-level AbortSignal 同时传给 provider、压缩、审批、工具和子代理；直接复用它不能实现“只抢占模型、继续同一任务”。三个真实 provider adapter 均已有请求取消入口，但未完成响应不返回可提交的完整 `AgentTurnResult`。现有 turn identity 只能隔离旧 turn，不能隔离同一 turn 内的旧请求。

项目没有 code-mode cell 或通用后台工具运行机制。本方案面向交互式主 assistant turn，延续 ANSI、普通屏幕、append-only transcript 和 provider-neutral 编排约束。

## Goals / Non-Goals

**Goals:**

- 让用户选择默认排队或即时引导，旧配置保持原行为。
- 即时引导在同一运行内生效，保留模型、显式工具策略与审批配置、todo、变更记录和会话身份；执行模式采用本次提交的选择。
- 抢占模型请求与重试，但不因引导强制取消已启动工具。
- 保证输入唯一消费、工具协议完整、记录顺序一致和旧请求回调隔离。
- 明确准备失败、Esc 移除、压缩、最终响应竞态和恢复行为。

**Non-Goals:**

- 不引入 code-mode、后台 cell、工具与新模型决策同时运行或第三方 TUI 库。
- 不提供立即停止危险操作的保证，不撤销已经发生的文件或外部副作用。
- 不向子代理广播消息，不变更 BTW、headless、shell 或 modal 的输入契约。
- 不通过普通消息文本改变模型、effort、skill、显式工具策略或审批配置；用户选择的 interaction mode 随提交生效。

## Decisions

### 1. 显式消息策略，按 turn 固定

增加 `ui.activeTurnMessagePolicy: "pending" | "steer"`，缺失或非法值归一化为 `pending`。`/config` → 常规显示“响应期间发送消息”，值为“排队”“即时引导”，说明后者不会强制停止当前工具。采用现有草稿、显式保存、配置 snapshot 和 watcher 更新链，不新增 render 热路径读盘。

主 assistant turn 启动时捕获策略，app 提交路由和 runtime 使用同一个固定值。运行中保存仅更新后续 turn 的默认值；已接收消息保持接收时的处理类型。未选用即时切换当前运行，避免旧队列突然注入模型。

### 2. 共用一个待处理单槽，先路由再准备

扩展现有消息状态而不额外增加无限队列。槽位携带消息身份、目标 turn、处理类型以及准备/等待/失败状态；普通排队仍保存原始文本。即时引导保留原文与最终 user record 所需素材，准备中也占用槽位。槽位非空时新的普通提交保留 live composer，不覆盖旧消息。

响应期可执行命令仍优先立即执行。必须经过 idle command/skill/shell 路由的输入仍作为 pending，不能因设置为 steer 而变成普通提示词。V1 即时引导仅处理正常消息及按既有规则可展开的 `@` 素材，不扩展运行中会话引用选择功能。

素材准备期间不抢占。准备成功且目标 turn 仍 active 时通知 runtime；准备失败保留可移除的失败卡片和原文，不写 user record、不取消当前请求、不覆盖用户后来编辑的草稿。目标 turn 先结束时，消息交给 idle dispatcher，沿用准备好的素材且不重复读取或追加输入历史。

每次准备普通 user record 时捕获当前选择的 mode，不继承 turn 启动模式，也不因 normal/plan 不同而降级排队。模式在消息应用的安全边界生效；此前已启动的工具、审批或子代理先按原执行边界收尾。后续请求复用普通提交的模式切换说明，工具分类、模式派生的 Bash 沙箱、后续委派及 usage 采用新 mode；显式 readonly/workflow 沙箱收紧仍保留。Bash handler 在每个调用启动时读取当前派生沙箱，不重建模型、registry 或其他快照。

### 3. 运行级输入通道，而不是并发启动新 run

通过 `AgentSessionInput` 提供最小 provider-neutral 运行中输入端口；端口负责有界消息的就绪通知、原子领取和唯一提交确认，不依赖 app 类或 renderer。app 持有输入准备和 session 持久化，runtime 持有安全边界与 `recordRegion`。

只有 runtime 在安全边界消费已准备好的消息；工具结果和被跳过调用先收尾，再将同一个 user record 发布到 app 并放入 `recordRegion`。此提交边界不执行 `beginUserTurn()`，不清空当前工具状态或释放 response lock；不允许其他路径再提交同一消息。消息领取与 user record 提交之间不得插入异步等待。

自动审批保留原 turn 的用户边界和配置 snapshot，但授权判断纳入该边界后已应用的 user record 原文，按顺序补充原请求。文件展开记录取 `displayText`，无展开时取 `text`；文件内容和工具结果不能建立授权。既有配对澄清答案继续参与判断，后续用户指令修订先前请求。用户指令仍使用原有 4000 Unicode code point 头尾截断与省略标记，总投影预算仍为 16000；超出用户指令预算不直接转人工，继续调用审批模型。仅移除新增的长度回退，审批模型否决、请求失败及动作无法安全投影等原有回退不变。

```text
composer → 输入路由 → 单槽 preparing → ready
                                      │
                 ┌────────────────────┴─────────────────────┐
                 │                                          │
          当前模型请求                                当前工具 / 压缩
          requestAbort                                等安全收尾
                 └────────────────────┬─────────────────────┘
                                  唯一提交边界
                           tools pairs → user record
                                      ↓
                         同一 loop 的下一次模型请求
```

“通知抢占”不等于“已应用消息”。消息在唯一提交前仍可被 Esc 移除；如果响应已因通知终止但消息后来被移除，runtime 继续原任务，不加入已移除文本、不生成用户取消提示。真正提交后槽位立即释放，该 user record 不再提供撤回操作。

### 4. turn 取消与请求抢占分离

保持现有 turn-level AbortSignal：Esc 真正取消时仍下传到工具、审批和子代理。每个普通模型请求另建 request-level AbortController，与 turn 取消联动；引导只取消这个请求级 controller。压缩和工具仅接收 turn 信号，不接收请求级抢占信号。

每次模型请求分配 step identity。发出抢占信号时立即使旧 step 的 token、reasoning、retry 和完成回调失效；等待旧请求实际结束后才启动新请求，不仅用 `Promise.race` 放任旧请求运行。只有被引导信号取消的请求才进入 continuation，真实错误仍走失败流程，turn 取消优先于请求抢占。

未选择“自动 Esc + 启动新 run”，因为该实现会取消工具、释放锁、重建运行并产生错误的中断事实；也不只在下一次请求前检查队列，因为那无法缩短长响应与重试等待。

### 5. 工具安全边界和调用配对

- 单个已启动工具自然收尾，保存实际结果后处理引导；不能将仍在运行的调用报告为取消。
- 已启动的连续并行只读组全部收尾，按 provider 原始顺序提交结果，再处理引导。
- 已完成 provider response 声明但尚未启动的调用不再执行。为每个调用构造 `ok: false` 的结果，明确说明“新用户指令到达，调用未执行”，并保持原始 call ID 和顺序。
- 所有必须补齐的工具结果先于新 user record。即使某调用尚未显示给 app，只要已被完整响应声明并进入下一次请求的 provider history，就必须成对收尾。
- 尚未完成的响应整体不能当作已完成声明；其半截参数或未提交调用不执行，不与完整响应的跳过逻辑混淆。

V1 不对长 Bash/MCP/子代理调用增加后台运行协议；工具耗时直接决定引导等待时长，该边界由配置说明和用户文档披露，footer 不展示等待原因。运行中的子代理作为当前调用的一部分等待，不收到父消息广播。

### 6. 抢占草稿与已完成历史

引导抢占立即冻结累计正文与尚未发布的可读 reasoning 草稿，并封闭旧回调，但保留 app 预览直到 SDK 实际收尾。确认请求被取消后，先将可读推理保存为本地 reasoning summary，再复用 `onAssistantSegment` 将非空正文保存为普通 assistant 记录，同步进入 app transcript、journal 和 runtime `recordRegion`，最后应用引导。此前已提交的完整 assistant segment、完整 provider records 和工具结果保留；已经发布的 reasoning summary 不重复提交，所有 reasoning summary 都不进入 provider 请求，也不代替缺失的 provider-private reasoning。

与 Esc 保存正文的契约对齐，不新增 partial 消息类型、元数据或“未完成”文字标记，现有 converter 按普通 assistant 正文处理。未完成 provider-private reasoning、工具参数和响应续接状态仍丢弃。完整响应返回时以其正文和私有记录为准，不能先落冻结草稿再重复落完整结果；真实错误与父 turn 取消保持原失败/Esc 收尾，不抢占其草稿所有权，也不伪造引导导致的任务中断通知。

三个 adapter 必须从安全的已提交历史重建下一次请求，其中可以包含按 Esc 契约保存的普通正文，但不包含半截私有记录或工具调用，不依赖被取消响应的续接状态；已有完整私有记录仍按各自协议转换。移除尚未应用的引导不会撤销已输出正文；被抢占请求收尾后保留正文并继续原任务。仅记录已取得的权威 usage，不把缺失取消请求 usage 当作零费用。

### 7. 终态竞态、Esc 与显示

runtime 在执行新工具、提交最终 assistant/onComplete 和构建下一请求前检查就绪输入。就绪消息在最终完成提交前赢得消费边界时，同一 turn 继续；如果原 provider response 已完整完成，则先将其完整正文和私有记录作为已完成 segment 提交，再追加引导，不调用结束 turn 的 onComplete。最终完成先提交或素材仍未准备好时，消息保持单一所有者并交给 idle dispatcher 启动下一轮。不得同时作为引导和下一轮输入消费。

Esc 保持高优先级 surface 优先；普通 composer 有未提交消息时先移除并使准备中的异步回调失效，下一次 Esc 才取消 turn。引导已落成 user record 时不再有可移除卡片，Esc 直接进入原 turn 的既有取消逻辑。

footer 用固定有界卡片展示消息预览与 Esc 移除提示。普通排队保留“当前回答结束后发送”说明；引导仅保留“准备引导消息”和准备失败提示，准备完成后显示引导标识，不展示等待原因或运行阶段。运行端口不承担阶段上报，卡片不依赖模型、工具或压缩的执行阶段；消息应用后卡片消失。它们参与现有 footer 高度预算，不追加 scrollback，不改变输入事件优先级。

## Risks / Trade-offs

- [工具执行中无法立即转向] → 在配置和文档明示安全等待边界，保留 Esc 的 best-effort 取消，不承诺后台执行。
- [取消请求仍有迟到事件] → step identity 在 abort 时失效，父 turn identity 继续隔离跨轮事件。
- [新指令跳过工具破坏协议] → 在新 user record 前补齐全部完整响应所声明的未执行调用，覆盖三个 converter 的契约测试。
- [app/runtime 双份历史错位影响压缩索引] → 唯一 user commit 与既有 tool batch 提交保持同序，用真实恢复和自动压缩测试核对。
- [提交消息与 final/Esc 同时发生] → 单槽状态转移和终态检查串行化，禁止未确认交付就丢弃消息。
- [抢占正文重复或在 Esc 竞态丢失] → 冻结预览直到 SDK 收尾，完整结果优先，正文复用唯一同步提交；保留终端稳定前缀，父级取消由既有 Esc 路径保存。
- [频繁引导重复请求增加费用] → 有界槽位、准备成功后抢占、披露权威 usage 的可见范围；默认策略维持 pending。

## Migration Plan

1. 先增加配置归一化和面板，旧配置无需迁移，默认 pending。
2. 增加运行中输入端口、请求级取消及安全工具边界，分别验证真实 adapter 和 fake fixtures。
3. 接入普通提交和 footer，跑 pending、Esc、命令及恢复回归；完成用户确认后才实施这些任务。
4. 用户可保存为 pending 回退体验；修改只影响下一轮，当前 steer turn 仍按已捕获策略完成。不改写历史 journal。

## Open Questions

当前无阻塞性产品问题。V1 已选择“工具等待安全收尾”和“正文保留与 Esc 对齐且不加未完成标记”；工具后台执行和对子代理定向引导仍留待独立变更讨论。
