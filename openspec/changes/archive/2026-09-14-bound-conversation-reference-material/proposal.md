## Why

`/reference` 引用历史会话时始终从 journal 重放出的全部 records 生成引用素材，完全忽略源会话的 compaction 状态：被压缩过多次的会话会把已经总结掉的旧历史重新全量喂给模型再总结一遍；素材总量也没有任何上限，一旦超过总结模型的上下文窗口，单次总结请求必然失败，用户只能看到笼统的失败提示。引用成本随源会话历史长度无界增长，需要把素材源对齐到源会话真实的活跃上下文，并给总结请求加上限与降级路径。

## What Changes

- 引用素材源改为源会话的活跃投影：源会话已有 compaction 时，素材由 `compaction.summaryText` 区块与 `activeStartIndex` 之后的 records 构成；压缩边界之前的原始 records 不再进入引用素材和总结输入。
- 新增总结输入上限 `min(64000, floor(contextWindow * 0.5))` tokens：素材超过引用预算但未超输入上限时保持单次总结；超过输入上限时先降级为头尾保留截断（优先保留 compacted_summary 区块与最早、最近若干条记录，中间记录以省略标注替代），再发起单次总结。
- 头尾截断降级发生时强化 `source_file` 提示：明确告知模型中段记录被省略，可使用现有 `read_files` 分页读取源 journal 回查。
- pending 引用素材从整段字符串调整为按记录粒度的结构化记录段，支持发送时按当前生效模型重新判定预算与截断。
- 明确本次不加总结输出上限（总结为模型结构化输出，Anthropic 路径另有固定 `max_tokens` 兜底）；单条记录 24,000 字符上限保持不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `conversation-reference`: 引用材料来源改为源会话活跃投影（compaction 感知）；总结投影增加输入上限与头尾截断降级；截断场景强化 `source_file` 分页回读提示。

## Impact

- `src/agent/context/conversation-reference.ts`: 素材构造、预算判定、总结输入降级与提示文案。
- `src/types/transcript.ts`: `PendingConversationReference` 素材字段结构化。
- `src/app/command/conversation-reference-command-port.ts`: 传参适配。
- `test/agent/conversation-reference.test.js`: 反转「不拼接 compaction summary」断言，新增截断降级与提示用例。
- 不改变 journal 格式、提交时固化的不可变性语义、既有 compaction 生命周期与 `/resume` 预览行为。
