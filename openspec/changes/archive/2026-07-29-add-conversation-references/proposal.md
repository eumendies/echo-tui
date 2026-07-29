## Why

用户在新问题中需要复用某次历史会话时，目前只能恢复整个会话、手工复制内容，或逐条选择消息，缺少一种低操作成本且由用户明确控制来源的“对话级引用”能力。新增该能力可以让用户只指定一次历史会话，由系统根据上下文规模选择全量导入或总结导入，同时保留按需查看原会话文件的路径。

## What Changes

- 新增对话级引用入口，用户选择一次历史会话即可把整次会话附加到当前 composer，不要求逐条选择消息。
- 在 composer 和已提交 user transcript 中展示简洁的引用卡片，使用会话标题等有辨识度的信息，不展示 session id、更新时间等内部信息。
- 按模型可见 token 预算决定引用投影：短会话导入完整的有效对话，长会话生成类似 compaction 的结构化引用总结。
- 在模型可见的引用上下文中附带源会话 journal 文件路径；模型需要更多细节时复用现有 `read_files` 按需读取，不新增专用会话读取工具。
- 将实际全量投影或引用总结随当前 user record 持久化，保证当前会话可重放；源会话后续变化不改写已经提交的引用内容。
- 对引用大小、生成中的取消、提交后清理及恢复/清空会话时的临时状态进行约束。

## Capabilities

### New Capabilities
- `conversation-reference`: 覆盖历史会话选择、composer 对话附件、长短会话投影、模型可见来源路径、持久化与生命周期行为。

### Modified Capabilities

无。

## Impact

- 影响 transcript store/context 的只读历史会话访问与会话展示 metadata。
- 影响 composer transient state、输入事件路由、footer surface 和 transcript user block 渲染。
- 影响普通消息提交前的上下文展开与 user transcript metadata。
- 复用现有 token estimator、provider agent 摘要调用、transcript journal 重放和 `read_files` 工具；不引入第三方依赖或新工具。
- 需要补充 command/controller、持久化投影、引用总结、渲染和提交生命周期测试，并由用户进行交互式终端验证。
