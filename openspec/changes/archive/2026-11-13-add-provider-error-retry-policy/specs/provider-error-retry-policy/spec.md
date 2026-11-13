## ADDED Requirements

### Requirement: Provider 流式失败分类
系统 SHALL 把流式 provider 失败归一为 provider-neutral 的语义类别，并 SHALL 以结构化证据作为分类依据，而不是以错误文案子串作为主要依据。类别 SHALL 至少包含 `transient`、`rate_limit`、`overloaded`、`stream_incomplete`、`provider_incomplete`、`content_filter`、`invalid_request`、`context_overflow`、`auth`、`quota`、`aborted` 和 `unknown`。分类证据 SHALL 按以下优先级取值：provider 结构化错误码、SDK 错误类型与 HTTP 状态、运行时网络错误特征、最后才是兼容文案表。分类结果 SHALL 携带可展示的脱敏消息、HTTP status（如存在）、provider 错误码（如存在）、服务端重试建议（如存在）和 request ID（如存在）。

#### Scenario: 结构化错误码优先于文案
- **WHEN** stream 失败事件携带 provider 结构化错误码
- **THEN** 系统 SHALL 依据该错误码确定语义类别
- **THEN** 系统 SHALL NOT 因文案不匹配而把该失败归类为 `unknown`

#### Scenario: 连接类异常归类为瞬时失败
- **WHEN** stream 迭代期间抛出带 `ECONNRESET`、`EPIPE`、`ETIMEDOUT`、`UND_ERR_*` 错误码或 premature close、socket hang up 特征的异常
- **THEN** 系统 SHALL 将其归类为 `transient`

#### Scenario: 服务端提前结束流归类为 stream_incomplete
- **WHEN** stream 在未收到 provider 完成事件的情况下正常结束
- **THEN** 系统 SHALL 将其归类为 `stream_incomplete`
- **THEN** 系统 SHALL NOT 将其归类为 `unknown`

#### Scenario: 服务端明确终止的响应不归类为可重试
- **WHEN** provider 返回 incomplete 事件或内容策略拒绝事件
- **THEN** 系统 SHALL 分别归类为 `provider_incomplete` 或 `content_filter`
- **THEN** 系统 SHALL NOT 将其归类为 `transient` 或 `stream_incomplete`

#### Scenario: 用户取消不归类为服务失败
- **WHEN** 流式请求因调用方取消信号中断
- **THEN** 系统 SHALL 归类为 `aborted`
- **THEN** 系统 SHALL NOT 把该中断归类为任何可重试类别

### Requirement: 重试决策与预算
系统 SHALL 依据失败类别给出 `never`、`server-directed` 或 `backoff` 三态重试决策，并 SHALL 为每个 provider turn 维护独立的有界重试预算。`transient` 与 `stream_incomplete` SHALL 使用 `backoff` 决策；`rate_limit` 与 `overloaded` SHALL 使用 `server-directed` 决策；`provider_incomplete`、`content_filter`、`invalid_request`、`context_overflow`、`auth`、`quota`、`aborted` 和 `unknown` SHALL 使用 `never` 决策。`server-directed` SHALL 表示「优先采纳服务端重试建议，缺失建议时回退到该类别自己的保守退避」，SHALL NOT 在缺失建议时直接终止。默认预算 SHALL 为 5 次重试，即单个 provider turn 最多 6 次 stream；硬上限 SHALL 为 20 次重试。预算 SHALL NOT 因服务端重试建议而增加。`transient` 与 `stream_incomplete` SHALL 共用同一套退避参数与预算，两者的区分 SHALL 只用于用户可见的失败原因文案。

#### Scenario: 瞬时失败使用退避重试
- **WHEN** 一次 provider turn 的 attempt 因 `transient` 或 `stream_incomplete` 失败
- **AND** 该 turn 的重试预算尚未耗尽
- **THEN** 系统 SHALL 等待退避时长后创建新的 stream

#### Scenario: 限流按服务端建议等待
- **WHEN** 一次 attempt 因 `rate_limit` 或 `overloaded` 失败
- **THEN** 系统 SHALL 优先使用失败信息中的服务端重试建议作为等待时长
- **AND** 系统 SHALL 在预算允许范围内创建新的 stream

#### Scenario: 限流缺少服务端建议时回退保守退避
- **WHEN** 一次 attempt 因 `rate_limit` 或 `overloaded` 失败
- **AND** 失败信息不包含任何可用的服务端重试建议
- **THEN** 系统 SHALL 回退到该失败类别的保守退避等待时长
- **THEN** 系统 SHALL 在保守子预算允许范围内创建新的 stream

#### Scenario: 保守子预算不占用主预算
- **WHEN** 一次 attempt 因 `rate_limit` 或 `overloaded` 失败且缺少服务端建议
- **THEN** 系统 SHALL 使用独立的保守子预算计数
- **THEN** 系统 SHALL 取保守子预算剩余次数与主预算剩余次数的较小值作为本次重试的判定依据

#### Scenario: 不可恢复失败不重试
- **WHEN** 一次 attempt 因 `invalid_request`、`context_overflow`、`auth`、`quota`、`provider_incomplete`、`content_filter` 或 `unknown` 失败
- **THEN** 系统 SHALL NOT 创建新的 stream
- **AND** 系统 SHALL 立即以该失败结束本次 provider turn

#### Scenario: 预算耗尽后立即失败
- **WHEN** 一个 provider turn 已用完重试预算且新的 attempt 仍失败
- **THEN** 系统 SHALL NOT 创建新的 stream
- **AND** 系统 SHALL 以最后一次 attempt 的脱敏错误结束本次 provider turn

#### Scenario: 预算上限语义为最多一次额外尝试
- **WHEN** 默认重试预算为 5 次
- **THEN** 单个 provider turn SHALL 最多发起 6 次 stream
- **THEN** 系统 SHALL NOT 把 5 解释为「5 次 stream」

#### Scenario: 重试预算按 provider turn 独立计算
- **WHEN** 一次 assistant turn 因工具调用产生多个连续 provider turn
- **THEN** 每个 provider turn SHALL 拥有独立的默认重试预算
- **THEN** 前一个 provider turn 已消耗的重试次数 SHALL NOT 从后续 provider turn 的预算中扣除

#### Scenario: stream 工厂抛错不扣减流式预算
- **WHEN** 执行器调用 stream 工厂且工厂本身抛出错误
- **THEN** 系统 SHALL 把该失败交给 SDK 的请求级重试策略处理
- **THEN** 系统 SHALL NOT 扣减该 provider turn 的流式重试预算
- **THEN** 系统 SHALL NOT 对请求级 4xx 失败应用流式退避

### Requirement: 退避与服务端重试建议
系统 SHALL 对 `backoff` 决策使用带抖动的有界指数退避，基础延迟 SHALL 为 500 毫秒，指数因子 SHALL 为 2，单次等待上限 SHALL 为 60 秒，抖动范围 SHALL 为 ±20%。系统 SHALL 优先使用服务端重试建议作为等待时长，取值后 SHALL 限制在 60 秒以内。可识别的服务端建议 SHALL 包含 `Retry-After` 秒数、`Retry-After` HTTP 日期、`retry-after-ms`、stream 内失败对象携带的 headers 中的等价字段，以及限流文案中的 `try again in <N>s` 或 `try again in <N>ms`。系统 SHALL 为 `server-directed` 类别在缺少服务端建议时提供保守退避：`rate_limit` 的基础延迟 SHALL 为 5 秒、`overloaded` 的基础延迟 SHALL 为 2 秒，两者的保守子预算 SHALL 各为 2 次，且同样适用 ±20% 抖动与 60 秒单次上限。退避等待与抖动 SHALL 通过可注入的时钟与随机源实现，以便测试断言区间而不强制固定具体毫秒值。

#### Scenario: 无服务端建议时使用指数退避
- **WHEN** 一次可重试失败不包含任何服务端重试建议
- **THEN** 系统 SHALL 使用 `min(500ms × 2^(n-1), 60s)` 作为基准等待时长
- **THEN** 系统 SHALL 在该基准上施加 ±20% 抖动

#### Scenario: 服务端建议覆盖本地退避
- **WHEN** 一次可重试失败携带服务端重试建议
- **THEN** 系统 SHALL 使用该建议的剩余时长作为等待时长
- **THEN** 系统 SHALL NOT 同时叠加本地指数退避

#### Scenario: 服务端建议被上限约束
- **WHEN** 服务端重试建议的时长超过 60 秒
- **THEN** 系统 SHALL 把等待时长限制为 60 秒

#### Scenario: 保守退避参数按类别区分
- **WHEN** 系统对缺少服务端建议的 `rate_limit` 失败应用保守退避
- **THEN** 基础延迟 SHALL 为 5 秒
- **WHEN** 系统对缺少服务端建议的 `overloaded` 失败应用保守退避
- **THEN** 基础延迟 SHALL 为 2 秒

#### Scenario: 退避依赖可注入以便测试
- **WHEN** 执行器被注入替代的时钟与随机源
- **THEN** 退避等待 SHALL 使用注入的实现
- **THEN** 系统 SHALL NOT 直接读取全局时钟或全局随机源

#### Scenario: 退避等待可被取消中断
- **WHEN** 退避等待期间调用方取消当前 turn
- **THEN** 系统 SHALL 立即结束等待
- **THEN** 系统 SHALL NOT 创建新的 stream
- **THEN** 系统 SHALL 以 `aborted` 语义结束本次 provider turn

### Requirement: 流式空闲超时
系统 SHALL 为每次 stream 消费设置空闲看门狗，在超过配置阈值仍未收到任何 stream 事件时把该 attempt 视为 `stream_incomplete` 并进入重试决策。默认空闲阈值 SHALL 为 300000 毫秒，并 SHALL 支持按 provider profile 覆盖。空闲超时 SHALL 与 turn 级取消信号相互独立，取消信号 SHALL 优先结束等待。系统 SHALL 在因空闲超时、取消或其他原因放弃一个 attempt 时显式释放该 attempt 的 stream 迭代器，SHALL NOT 依赖垃圾回收或底层实现自行收敛。

#### Scenario: 空闲超时归类为瞬时断流
- **WHEN** 一次 attempt 在空闲阈值内未收到任何 stream 事件
- **THEN** 系统 SHALL 以 `stream_incomplete` 结束该 attempt
- **THEN** 系统 SHALL 按重试决策判断是否创建新的 stream

#### Scenario: 空闲阈值可配置
- **WHEN** provider profile 配置了合法的 `streamIdleTimeoutMs`
- **THEN** 系统 SHALL 使用该值作为空闲阈值

#### Scenario: 持续有事件时不触发空闲超时
- **WHEN** stream 在空闲阈值内持续产生任意类型事件
- **THEN** 系统 SHALL NOT 触发空闲超时

#### Scenario: 放弃 attempt 时释放 stream 迭代器
- **WHEN** 系统因空闲超时或取消而放弃当前 attempt
- **THEN** 系统 SHALL 调用该 stream 的迭代器释放入口
- **THEN** 系统 SHALL 在释放完成后才判断是否创建新的 stream
- **THEN** 系统 SHALL NOT 让未完成的迭代读取继续持有底层连接

### Requirement: attempt 级重试门控
系统 SHALL 分别跟踪单个 attempt 的以下事实：是否已向 app 发出非空 assistant 正文增量、是否已向 app 发出非空 reasoning 预览、是否已向 app 发出 reasoning 完成通知、是否已解析出完整 provider 工具调用、是否已产生 provider-private record。任一除 reasoning 预览以外的事实成立时，该 attempt SHALL NOT 被自动重试。仅 reasoning 预览成立的 attempt SHALL 允许重试，系统 SHALL 在创建新 attempt 前使 app 丢弃该 attempt 的 reasoning 预览。compaction 请求 SHALL NOT 进入自动重试。

#### Scenario: 正文已输出时不重试
- **WHEN** 一次 attempt 已通过文本增量回调向 app 发出至少一个非空正文增量
- **AND** 该 attempt 随后以可重试类别失败
- **THEN** 系统 SHALL NOT 创建新的 stream
- **THEN** 系统 SHALL 以脱敏错误结束本次 provider turn
- **THEN** 系统 SHALL NOT 回退或替换已发出的正文

#### Scenario: 仅 reasoning 预览已输出时允许重试
- **WHEN** 一次 attempt 已通过 reasoning 回调向 app 发出非空 reasoning 预览
- **AND** 该 attempt 尚未发出非空 assistant 正文增量
- **AND** 该 attempt 尚未发出 reasoning 完成通知
- **AND** 该 attempt 以可重试类别失败
- **THEN** 系统 SHALL 在创建新 attempt 前使 app 丢弃该 attempt 的 reasoning 预览
- **THEN** 系统 SHALL 按重试决策创建新的 stream

#### Scenario: 已发出 reasoning 完成通知时不重试
- **WHEN** 一次 attempt 已通过 reasoning 回调向 app 发出完成通知
- **AND** 该 attempt 随后以可重试类别失败
- **THEN** 系统 SHALL NOT 创建新的 stream
- **THEN** 系统 SHALL 以脱敏错误结束本次 provider turn

#### Scenario: 已产生 provider-private record 时不重试
- **WHEN** 一次 attempt 已产生 provider-private record
- **AND** 该 attempt 随后以可重试类别失败
- **THEN** 系统 SHALL NOT 创建新的 stream
- **THEN** 系统 SHALL 以脱敏错误结束本次 provider turn

#### Scenario: compaction 请求不重试
- **WHEN** 一次 compaction 摘要请求的 stream 以可重试类别失败
- **THEN** 系统 SHALL NOT 创建新的 stream

#### Scenario: 已产生工具调用时不重试
- **WHEN** 一次 attempt 已解析出完整的 provider 工具调用
- **AND** 该 attempt 随后以可重试类别失败
- **THEN** 系统 SHALL NOT 创建新的 stream
- **THEN** 系统 SHALL 以脱敏错误结束本次 provider turn

### Requirement: 共享重试执行器与 adapter 接入
系统 SHALL 提供 provider-neutral 的流式重试执行器，OpenAI Responses、Codex、OpenAI Chat Completions 与 Anthropic adapter SHALL 共用同一执行器与同一失败分类实现。执行器 SHALL 接收 stream 工厂、单次 attempt 读取函数、失败分类入口、重试策略与取消信号，并 SHALL 在每次重试时通过工厂重新创建 stream。adapter 特化 SHALL 只体现在协议事件的分类映射上，SHALL NOT 体现在重试决策或退避参数上。

#### Scenario: 每次重试创建新 stream
- **WHEN** 执行器决定重试
- **THEN** 执行器 SHALL 调用 stream 工厂获取新的 AsyncIterable
- **THEN** 执行器 SHALL NOT 复用上一次 attempt 已消费或已失败的 stream

#### Scenario: Codex 重试复用同一 turn 凭据与请求快照
- **WHEN** Codex adapter 的某个 provider turn 进入重试
- **THEN** 系统 SHALL 复用该 turn 已解析的 OAuth credential、client 和不可变请求快照
- **THEN** 系统 SHALL NOT 为每次 attempt 重新读取凭据文件

#### Scenario: OpenAI Chat 流中断可重试
- **WHEN** OpenAI Chat Completions stream 在未产生正文与工具调用前以可重试类别失败
- **THEN** adapter SHALL 通过共享执行器创建新的 stream

#### Scenario: Anthropic 过载事件可重试
- **WHEN** Anthropic stream 返回 `overloaded_error` 或等价服务端错误事件
- **THEN** adapter SHALL 把该事件归类为 `overloaded`
- **THEN** adapter SHALL 在该事件携带服务端重试建议时按建议等待
- **THEN** adapter SHALL 在该事件不携带服务端建议时按 `overloaded` 的保守退避等待
- **THEN** adapter SHALL 在保守子预算允许范围内创建新的 stream

### Requirement: 重试可见性与最终错误
系统 SHALL 在每次发起重试前向 app 发出本地可见的重试通知，通知 SHALL 包含当前重试次数、预算上限、失败原因和下次等待时长。重试通知 SHALL 以本地 notice 记录呈现并持久化，SHALL NOT 伪装为 assistant 正文。重试预算耗尽时，最终错误 SHALL 包含已重试次数，并 SHALL 保留最后一次 attempt 可用的 request ID。

#### Scenario: 重试通知包含原因与次数
- **WHEN** 系统决定发起第 n 次重试
- **THEN** 系统 SHALL 发出包含 `n`、预算上限、失败原因和等待时长的本地重试通知
- **THEN** 重试通知 SHALL 以本地 notice 记录持久化

#### Scenario: 重试通知前保存 pending 正文
- **WHEN** 系统即将插入重试通知且存在尚未提交的流式显示内容
- **THEN** 系统 SHALL 先完成既有流式内容的显示收尾
- **THEN** 系统 SHALL 保持记录顺序为重试通知之后的新内容

#### Scenario: 预算耗尽的最终错误说明重试次数
- **WHEN** 重试预算耗尽且最后一个 attempt 失败
- **THEN** 最终错误 SHALL 包含已重试次数
- **THEN** 最终错误 SHALL 保留最后一次 attempt 可用的 request ID
- **THEN** 最终错误 SHALL NOT 包含 API key、Bearer token 或其他敏感凭据

#### Scenario: 未发生重试时错误信息不增加重试描述
- **WHEN** 一次 provider turn 首次 attempt 即因不可重试类别失败
- **THEN** 最终错误 SHALL 保持既有失败反馈语义
- **THEN** 最终错误 SHALL NOT 包含重试次数描述

### Requirement: 重试策略配置
provider profile SHALL 支持可选的 `streamMaxRetries` 与 `streamIdleTimeoutMs` 配置项。系统 SHALL 对合法整数且超过硬上限的配置限制到硬上限，SHALL NOT 静默回退到默认值。`streamMaxRetries` 为 `0` SHALL 表示关闭流式重试。系统 SHALL 对非整数、负数或非数字配置回退到默认值而不使配置解析失败。`streamIdleTimeoutMs` SHALL 具有 10000 毫秒的下限。缺省配置 SHALL 使用默认预算与默认空闲阈值，SHALL NOT 要求用户修改 `~/.echo/config.json`。

#### Scenario: 自定义预算生效
- **WHEN** provider profile 配置了合法的 `streamMaxRetries`
- **THEN** 系统 SHALL 使用该值作为该 provider 的流式重试预算

#### Scenario: 零预算关闭流式重试
- **WHEN** provider profile 的 `streamMaxRetries` 为 `0`
- **THEN** 系统 SHALL 只发起一次 stream，SHALL NOT 自动重试
- **THEN** 系统 SHALL NOT 把 `0` 视为非法值回退默认预算

#### Scenario: 超上限预算被限制到硬上限
- **WHEN** 该值为合法整数但超过硬上限
- **THEN** 系统 SHALL 把有效预算限制为硬上限
- **THEN** 系统 SHALL NOT 静默回退到默认重试预算

#### Scenario: 非法类型回退默认值
- **WHEN** provider profile 的 `streamMaxRetries` 或 `streamIdleTimeoutMs` 为非整数、负数或非数字
- **THEN** 系统 SHALL 回退到对应的默认值
- **THEN** 系统 SHALL NOT 因该配置项使 provider 配置解析失败

#### Scenario: 缺省配置不改变配置读取要求
- **WHEN** `~/.echo/config.json` 未包含重试相关配置
- **THEN** 系统 SHALL 使用默认重试预算与默认空闲阈值继续运行
