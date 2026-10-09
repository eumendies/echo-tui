## ADDED Requirements

### Requirement: 即时引导消息有界接收与准备
使用 `steer` 策略的交互式主 assistant turn SHALL 在普通 composer 提交非空普通消息时接收引导输入，与 pending 共用一个 transient 单槽。接收 SHALL 消费当时草稿并只记录一次输入历史，后续 live composer 文本和光标 SHALL 保持独立。系统 SHALL 在既有文件 mention 等素材准备成功后才通知请求抢占；准备失败 SHALL 保留原文和可移除的失败状态，不写 user record、不抢占当前运行、不覆盖新草稿。响应期命令和更高优先级 surface SHALL 继续走既有路由，不得被普通引导绕过。

#### Scenario: 准备成功才请求抢占
- **WHEN** 当前 turn 使用 `steer`，单槽为空，用户提交普通消息或包含 `@` 素材的普通消息
- **THEN** 系统 SHALL 消费当时 composer 并进入准备状态
- **THEN** 准备完成前 SHALL NOT 抢占模型或追加该 user record
- **THEN** 准备成功且目标 turn 仍 active 时 SHALL 通知当前运行有就绪引导

#### Scenario: 准备失败保留新草稿
- **WHEN** 引导 A 的素材准备失败，用户已在 composer 编辑草稿 B
- **THEN** 系统 SHALL 保留 A 的原文并显示可移除的准备失败状态
- **THEN** B 的文本与逻辑光标 SHALL 保持不变
- **THEN** 当前模型 SHALL NOT 因 A 的失败被取消，A SHALL NOT 进入 transcript

#### Scenario: 有待处理消息时保留第二条输入
- **WHEN** 单槽中存在 preparing、ready、等待工具或准备失败的消息 A
- **AND** 用户提交另一条普通消息 B
- **THEN** 系统 SHALL 保留 A 并保持 B 在 composer 中
- **THEN** 系统 SHALL NOT 覆盖 A、创建第二个槽位或重复记录 B 的输入历史

#### Scenario: 高优先级交互不被引导绕过
- **WHEN** 审批、用户问题、file picker 或 command surface 正在接管输入
- **THEN** Enter 和 Esc SHALL 按该 surface 的既有规则处理
- **THEN** 系统 SHALL NOT 把该 surface 的回答转换为引导消息或自动批准工具

### Requirement: 请求级抢占与 turn 级取消分离
就绪引导在普通模型请求建立、响应流或可中断重试等待期间到达时，runtime SHALL 尽快中止当前请求步骤，待其收尾后在同一个 assistant turn 内带新指令继续。请求抢占 SHALL NOT 触发 turn-level 取消、强制停止工具或子代理、释放 response lock、重建运行配置、发送任务完成事件或生成“已中断模型回答”提示及 error record。实际 turn 取消 SHALL 优先于引导 continuation，真实非抢占错误 SHALL 保持既有失败语义。

#### Scenario: 流式响应期间引导
- **WHEN** 当前模型正在输出正文或 reasoning，且引导消息已经准备好
- **THEN** runtime SHALL 请求终止当前模型步骤并等待其取消收尾
- **THEN** runtime SHALL 带新 user record 发起下一次请求而不等待原响应正常完成
- **THEN** session、turn identity、模型、effort、显式工具策略与审批配置、todo 和变更记录 SHALL 保持当前运行的固定值；interaction mode SHALL 使用新消息提交时的选择

#### Scenario: 重试等待期间引导
- **WHEN** 当前 provider 正在等待可中断的重试退避，且引导就绪
- **THEN** 系统 SHALL 中断该等待，关闭该步骤后处理新指令
- **THEN** 系统 SHALL NOT 把请求级抢占重试为原来的失败请求或显示为模型失败

#### Scenario: 父 turn 取消优先
- **WHEN** 请求抢占与真正的 turn-level Esc 取消同时发生
- **THEN** runtime SHALL 执行既有 turn 取消收尾
- **THEN** runtime SHALL NOT 因捕获请求级取消而发起新的 continuation

#### Scenario: 真实 provider 错误不是引导
- **WHEN** provider 出现非请求抢占导致的错误
- **THEN** 系统 SHALL 沿用既有错误处理而不无限继续当前 loop
- **THEN** 尚未提交的用户输入 SHALL 保持明确所有者并按终态移交规则处理

### Requirement: 每次普通提交使用当前选择模式
普通 user record SHALL 在素材准备前捕获用户当前选择的 interaction mode，准备期间或已准备素材移交下一轮时 SHALL NOT 被后来的界面选择覆盖。即时引导 SHALL NOT 继承主 turn 启动模式，SHALL NOT 因 normal/plan 模式不同而另行排队。runtime SHALL 在消息实际应用边界同步更新后续请求的模式说明、工具风险分类、模式派生 Bash 沙箱、后续子运行的父模式及用量归因。模式变更 SHALL NOT 放宽 workflow 明确指定的 readonly 工具策略或沙箱收紧，也 SHALL NOT 影响已启动调用。

#### Scenario: normal 与 plan 同轮切换
- **WHEN** 主 turn 以 normal 或 plan 运行，用户选择另一模式并提交普通引导
- **THEN** 消息 SHALL 按 steer 进入相同主 turn，不因模式不同而走下一轮
- **THEN** 消息应用后的请求及未启动工具 SHALL 使用该提交模式，显式 workflow 限制仍保留
- **THEN** app transcript 与 runtime SHALL 保存相同模式说明和原始展示文本，后续普通提交 SHALL 从已提交历史恢复最新模式

#### Scenario: 准备期间再次选择模式
- **WHEN** 用户以 plan 提交引导，素材尚未准备好时将界面改为 normal
- **THEN** 已接收引导 SHALL 保持 plan，无论进入当前 turn 或准备完成后移交新 turn
- **THEN** 未实际应用或已移除消息 SHALL NOT 改变当前运行模式

#### Scenario: 响应期间选择下一条消息模式
- **WHEN** 主 assistant turn 响应中，普通 composer 接管输入且用户按 Tab
- **THEN** 系统 SHALL 允许切换下一条消息的界面 mode，不中断 turn 或即时修改运行中的工具
- **THEN** 新 mode SHALL 仅随下一条实际应用的消息进入执行边界；高优先级界面和非 assistant 响应锁保持原规则

### Requirement: 工具与压缩采用安全引导边界
引导 SHALL NOT 强制取消已经启动的工具。runtime SHALL 等单个调用或已启动并行只读组收尾、提交实际结果后再处理就绪输入。已完成 provider response 声明但尚未启动的调用 SHALL 不再启动，SHALL 使用原 call ID 成对补齐说明“因新用户指令跳过且未执行”的失败结果，并在新 user record 前完成所有协议收尾。自动压缩 SHALL 不接受请求级抢占，压缩完成后 SHALL 重新检查就绪输入和上下文预算。

#### Scenario: 写工具执行中提交引导
- **WHEN** 写文件或 Bash 等单个工具已经启动且引导就绪
- **THEN** 系统 SHALL 等该调用按既有执行或超时规则收尾，不因引导发出工具取消信号
- **THEN** 该调用的实际结果 SHALL 在新 user record 之前提交
- **THEN** runtime SHALL 在启动下一个调用前处理引导

#### Scenario: 并行只读组收尾
- **WHEN** 一个并行只读组已经启动，部分工具尚未返回，且引导就绪
- **THEN** runtime SHALL 等已启动组全部收尾并按 provider 原始顺序提交结果
- **THEN** runtime SHALL NOT 因引导继续启动后续工具组

#### Scenario: 跳过完整响应声明的剩余调用
- **WHEN** 完整 provider response 声明多个工具调用，部分尚未启动，且 runtime 准备应用引导
- **THEN** 系统 SHALL 为每个尚未启动调用保存匹配的 call/result pair，结果 `ok` SHALL 为 false 且说明未执行原因
- **THEN** 原始 call ID、名称和顺序 SHALL 保留，已完成调用 SHALL NOT 重复补写
- **THEN** 即使尚未显示某调用，下一次 provider request 中也 SHALL NOT 出现没有匹配结果的已声明调用

#### Scenario: 压缩期间消息就绪
- **WHEN** 自动压缩正在运行且引导准备完成
- **THEN** 系统 SHALL 保留输入并等待压缩完成，不取消压缩摘要请求
- **THEN** runtime SHALL 应用压缩结果后提交引导，再按更新后的上下文检查预算并构建普通请求

#### Scenario: 子代理正在运行
- **WHEN** 主运行等待已启动的 `run_subagent` 且用户提交引导
- **THEN** 主运行 SHALL 在该调用安全收尾后应用消息
- **THEN** 系统 SHALL NOT 自动广播新消息或取消子代理，除非用户另行真正取消 turn

### Requirement: 引导记录唯一提交并保持协议完整
runtime SHALL 在安全边界将同一个准备好的 user record 唯一提交到 `recordRegion`、app transcript 与 session journal，不重新开始 user turn。相关工具收尾 SHALL 先于 user record，后续普通 provider request SHALL 包含该输入。被抢占步骤截至抢占边界的非空正文 SHALL 按 Esc 的契约保存为普通 assistant 记录，位于引导之前并进入后续模型上下文，SHALL NOT 添加未完成标记或专用消息类型；尚未发布的可读推理 SHALL 保存为非 provider-facing 的本地 reasoning summary。未提交 provider-private records 与半截工具参数 SHALL NOT 被持久化或执行；之前已提交的完整 segments、私有记录、真实工具结果和本地 summary SHALL 保持既有语义。系统 SHALL 只记录已获得的权威 usage，不把缺失 usage 宣称为零消耗。

#### Scenario: app 和 runtime 看到同一条消息
- **WHEN** runtime 在安全边界应用引导 A
- **THEN** app transcript、journal 和运行中 `recordRegion` SHALL 各包含一次相同的 A user record 且顺序一致
- **THEN** 消息 SHALL 从单槽移除，不再由 idle dispatcher 发送或重复写输入历史
- **THEN** response lock SHALL 保持占用，下一次请求 SHALL 包含 A

#### Scenario: 保存被中止正文并排除半截私有协议
- **WHEN** 之前的完整 assistant segment 和工具结果已经提交，当前新请求仅输出半截正文或工具参数后被引导抢占
- **THEN** 系统 SHALL 保留之前的已提交记录
- **THEN** 系统 SHALL 等 SDK 收尾后将冻结正文唯一保存为普通 assistant 记录，再追加引导；迟到 token SHALL NOT 改变保存文本
- **THEN** 系统 SHALL 保存尚未发布的可读 reasoning 草稿为本地 summary，SHALL NOT 重复已经发布的 summary、追加半截 private record 或执行半截调用
- **THEN** 所有非 provider-facing reasoning summary SHALL 不被回滚或作为私有推理的替代输入

#### Scenario: 引导抢占后紧接整轮 Esc
- **WHEN** 请求已被引导通知取消，SDK 尚未收尾，用户移除引导后再次按 Esc 取消 turn
- **THEN** app SHALL 按既有 Esc 路径保存冻结正文和本地推理一次
- **THEN** 旧 SDK 收尾 SHALL NOT 重复保存正文、追加引导或发起下一次请求

#### Scenario: 三种 provider 安全续接
- **WHEN** OpenAI Responses、OpenAI Chat 或 Anthropic 请求被引导抢占
- **THEN** 对应 adapter SHALL 从安全完整历史构建下一次请求，不依赖未完成响应的续接状态
- **THEN** 既有完整私有记录 SHALL 按该协议转换，所有已声明完整工具调用 SHALL 有匹配结果

#### Scenario: 引导后恢复会话
- **WHEN** 已应用引导的 session 通过 `/resume` 恢复
- **THEN** 完整 segments、真实或跳过的工具 pairs 和引导 user record SHALL 按原顺序恢复
- **THEN** 系统 SHALL NOT 恢复未完成瞬时草稿或再次自动发送已提交消息

### Requirement: 同轮请求隔离与终态交付竞态
系统 SHALL 使用 turn identity 与请求步骤 identity 隔离回调，在发出请求抢占信号时立即使旧请求回调失效。runtime SHALL 在启动工具、提交最终响应和构建后续请求前检查就绪输入；消息与终态 SHALL 通过单一所有权转移保证不重复、不丢失。当前 turn 已完成、失败或素材准备完成时目标已失效的消息 SHALL 转交 idle dispatcher；已准备的普通素材 SHALL 不被重复读取。未经用户移除的已接收输入 SHALL NOT 仅因 final 回调竞态静默丢弃。

#### Scenario: 同一个 turn 的旧请求迟到
- **WHEN** 请求 A 已被抢占，同一个 turn 随后启动请求 B
- **AND** A 迟到触发 token、reasoning、retry、工具或完成回调
- **THEN** A 的回调 SHALL NOT 更新 B 的预览、追加记录、启动工具、结束 turn 或修改响应锁

#### Scenario: 就绪输入先于最终完成提交
- **WHEN** 模型准备返回最终答案，但引导 A 已在最终完成提交边界前就绪
- **THEN** runtime SHALL 唯一应用 A 并继续当前 turn
- **THEN** 原 provider response 若已完整完成，其正文和私有记录 SHALL 先作为完整 segment 提交，再提交 A，SHALL NOT 另存冻结草稿；未完成响应 SHALL 按正文保留规则处理
- **THEN** 系统 SHALL NOT 先调用 onComplete 再把 A 重复发送为新 turn

#### Scenario: 最终完成先于就绪输入
- **WHEN** 当前 turn 的最终完成已提交，或消息 A 的素材此时仍在准备
- **THEN** A SHALL 保持单一所有者并在准备成功后按正常 idle 提交规则处理
- **THEN** 系统 SHALL NOT 向已经结束的 turn 注入 A 或丢弃 A
- **THEN** 已准备好的素材 SHALL 只使用一次，不重新展开附件或追加输入历史

#### Scenario: 消费后旧 finally 不影响新状态
- **WHEN** 引导已经提交或被移交新 turn，旧异步步骤随后执行 finally
- **THEN** 旧步骤 SHALL NOT 清空新消息槽位、live composer 或后续运行的状态

### Requirement: 引导指令超出投影预算仍执行自动审批
auto 模式下，同轮已应用引导 SHALL 纳入现有有界审批投影，SHALL 沿用用户指令头尾截断、省略标记及总预算，SHALL NOT 仅因用户指令超出投影预算而跳过审批模型或直接转人工。审批模型的允许/否决、请求失败及动作投影等既有处理 SHALL 保持不变。

#### Scenario: 超长引导由审批模型允许
- **WHEN** 用户指令与同轮引导超出指令投影预算，待审批动作可正常投影且没有命中会话授权
- **THEN** 系统 SHALL 将有界投影发送给审批模型
- **THEN** 审批模型返回 yes 时 SHALL 按既有规则一次允许，不因指令长度请求人工审批

#### Scenario: 超长引导由审批模型否决
- **WHEN** 同样的超长指令投影被审批模型判断为 no
- **THEN** 系统 SHALL 保留原有人工审批回退，而不无条件允许动作

### Requirement: 引导卡片与可撤销瞬时生命周期
系统 SHALL 在普通 composer 上方以固定有界卡片展示尚未提交的引导消息，保留准备中和准备失败提示，准备完成后仅显示引导标识、消息预览和移除提示，SHALL NOT 展示等待原因或运行阶段；预览 SHALL 单行化、安全截断并参与现有 footer 高度预算。高优先级 surface 之后的 Esc SHALL 先移除尚未提交消息并隔离其准备回调，之后的 Esc 才取消 turn。通知请求抢占 SHALL 不等于消息已经提交；若消息在提交前被移除，runtime SHALL 不应用该文本且继续原任务。成功 `/clear`、`/resume` 和退出 SHALL 清理未提交 transient 状态。

#### Scenario: 工具期间保留引导预览而不展示等待原因
- **WHEN** 引导消息准备好但当前工具尚未收尾
- **THEN** footer SHALL 显示引导标识、有界预览和移除提示，SHALL NOT 展示工具等待原因
- **THEN** 卡片 SHALL NOT 宣称消息已发送或工具已经停止

#### Scenario: 压缩期间长预览有界且不展示等待原因
- **WHEN** 引导等待自动压缩且正文多行或很长
- **THEN** footer SHALL 显示引导标识并使用固定有界预览，SHALL NOT 展示压缩等待原因
- **THEN** composer、消息卡片与 streaming preview 总高度 SHALL 遵守现有 `rows - 2` 预算且不切换 alternate screen

#### Scenario: Esc 移除准备中或等待中的消息
- **WHEN** 没有更高优先级 surface，存在尚未提交的引导消息且用户按 Esc
- **THEN** 系统 SHALL 清除消息并使其异步准备或通知回调失效
- **THEN** 系统 SHALL NOT 追加该 user record 或任务中断提示；先前已因引导中止的原回答正文 SHALL 仍按唯一提交规则保留
- **THEN** 当前 turn SHALL 继续；即使请求已因通知结束，后续请求也 SHALL 不包含被移除文本

#### Scenario: 已应用消息不再提供移除操作
- **WHEN** 引导已经落成 user record
- **THEN** 消息卡片 SHALL 消失，该记录 SHALL NOT 因后续 Esc 被撤销
- **THEN** 没有其他待处理输入或高优先级 surface 时，Esc SHALL 按现有规则取消当前 turn

#### Scenario: 未提交消息不跨进程恢复
- **WHEN** session 切换、清空或进程退出时存在未提交引导
- **THEN** 系统 SHALL 清理 transient 单槽并隔离旧准备回调
- **THEN** 系统 SHALL NOT 持久化或在恢复时自动重发该消息
