## MODIFIED Requirements

### Requirement: 上下文长度估算
系统 SHALL 在发起每次 provider 请求前估算即将发送的上下文 token 长度。估算 SHALL 结合字符启发式、模型可见图片的非零估算成本与上一次请求返回的 `usage` 真值：当存在适用于当前投影的上一轮 `input_tokens` 真值时，系统 SHALL 以该真值为基线并叠加此后新增活跃记录的文本及图片估算增量；当不存在适用真值时，系统 SHALL 对完整投影的文本及图片做估算。图片附件的 base64 长度 SHALL NOT 直接当作视觉 token 数；本地不可见角色 SHALL NOT 被计入。压缩或附件省略使锚点与当前投影不再一致时，系统 SHALL 使旧锚点失效并重新估算。

#### Scenario: 首轮无 usage 真值时纯字符估算
- **WHEN** 当前 session 尚未取得任何 `usage` 真值且即将发起请求
- **THEN** 系统 SHALL 对即将投影发送的全部文本内容做字符估算得到文本预估 token 数
- **THEN** 系统 SHALL 对模型可见图片追加非零图片预估 token 数

#### Scenario: 有 usage 真值时按增量校准
- **WHEN** 上一次请求返回了 `input_tokens` 真值，且其后追加了新的活跃记录
- **THEN** 系统 SHALL 以上一轮 `input_tokens` 为基线
- **THEN** 系统 SHALL 叠加新增活跃记录的文本字符与图片估算增量得到当前预估 token 数

#### Scenario: 恢复历史图片会话
- **WHEN** 会话恢复后没有可用的 usage 锚点，活跃历史包含多条附图记录
- **THEN** 系统 SHALL 对这些图片做非零成本估算，而非只估算记录文本

#### Scenario: 历史投影变化使旧锚点失效
- **WHEN** 之前记录的模型可见图片被本次请求预算省略或历史经过上下文压缩
- **THEN** 系统 SHALL NOT 将未调整的旧 `input_tokens` 锚点当作新投影的准确基线

## ADDED Requirements

### Requirement: 压缩摘要请求受图片预算保护
系统 SHALL 在自动或强制压缩摘要请求发出前，对被压缩区间的用户和工具图片施加与普通请求相同的总图片附件字节预算。超预算时 SHALL 仅在摘要请求的发送副本中省略较早图片，保留模型可见文本、工具调用/结果关系、provider reasoning 记录以及摘要指令原有顺序；被压缩历史原记录 SHALL NOT 被改写。摘要请求 SHALL 继续使用既有原生 provider 转换器，不得把多模态历史拍平成纯文本 role 列表。压缩摘要及 usage 的既有处理规则 SHALL 保持不变。

#### Scenario: 自动压缩大量历史图片
- **WHEN** 被压缩区间包含的图片累计超过单次 provider 请求图片预算
- **THEN** 摘要请求 SHALL NOT 携带超预算图片附件
- **THEN** 摘要请求 SHALL 保留工具调用/结果配对和足以识别省略图片的文字提示

#### Scenario: 手动压缩大量历史图片
- **WHEN** 用户执行 `/compact` 且待压缩历史图片累计超过请求预算
- **THEN** 用于生成摘要的请求 SHALL 遵守相同图片预算

#### Scenario: 摘要输入中的原始附件不被删除
- **WHEN** 摘要请求省略了某条 `tool_result` 的图片
- **THEN** 会话持久化历史中的同一条 `tool_result` SHALL 仍保存原图片附件

#### Scenario: 摘要失败不改变原历史
- **WHEN** 有界摘要请求失败或返回空摘要
- **THEN** 系统 SHALL 维持现有压缩失败/未采纳语义，并 SHALL NOT 以失败为由删除原始图片历史
