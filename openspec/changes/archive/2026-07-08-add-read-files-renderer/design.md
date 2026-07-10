## Context

当前 transcript 渲染层通过 `renderToolRecordLines` 按 `toolName` 分发专属 renderer；`apply_patch`、`run_bash_command` 和 todo 工具已有定制展示，`read_files` 仍落到通用 renderer。通用 renderer 会直接展示 `read_files` 的完整 arguments JSON 和 result 文本，虽然保留了模型需要的原始信息，但对用户来说目录列表、文本文件 envelope、图片/PDF 元数据和错误信息都偏机器格式。

`read_files` handler 已经输出稳定的文本 envelope：每个读取结果以 `--- <kind>: <path>` 开头，随后按类型包含 `entries:`、`content:` fenced block、`image_attached: true`、`extracted_text:` fenced block、`error:` 等字段。因此第一版 renderer 可以在不改变 tool result schema 的前提下解析现有文本，并在解析失败时回退到通用展示。

## Goals / Non-Goals

**Goals:**

- 让 `read_files` tool call 行使用简洁的路径摘要展示，并保持工具名为 `read_files`。
- 让 `read_files` tool result 按文件类型展示更清晰的头部、目录列表、读取摘要、附件/PDF 元数据和错误状态。
- 保持 transcript record、provider-visible tool result 文本、附件传递和读取行为不变。
- 在输入格式异常、历史 transcript 或未来 envelope 变化时安全降级到通用 renderer。
- 保持所有可见行遵循现有 terminal width、ANSI theme 和 tool message 缩进规则。

**Non-Goals:**

- 不为 `read_files` 增加新的 display metadata schema。
- 不改变 `read_files` 的读取限制、分页语义、目录枚举、图片附件或 PDF 提取行为。
- 不引入新的终端 UI 依赖或完整文件浏览器交互能力。
- 不改变其他工具的展示格式，除非为了接入分发逻辑做最小调整。

## Decisions

1. **第一版解析现有 envelope，而不是扩展 tool result metadata。**
   - 选择原因：改动集中在 render 层，不影响 agent/tool 执行链路，也不会改变持久化 transcript 或 provider continuation 输入。
   - 备选方案：给 `ReadFilesToolExecutionResult` 增加结构化 `display` metadata。该方案更稳，但会扩大类型、执行结果和持久化面的改动；当前需求主要是展示改善，暂不需要。

2. **调用行展示路径摘要，结果行展示结构化内容。**
   - 调用行解析 `argumentsText.files`，展示 `read_files(path)`、`read_files(path@offset+limit)` 或多路径摘要，避免完整 JSON 占据 transcript。
   - 结果行按 envelope 类型投影：文本和 PDF 只显示读取摘要或关键元数据以保留多文件结果可见性，目录转成更紧凑的树状列表，图片展示附件元数据，错误突出 path 和原因。
   - 备选方案：只美化 result，不改 call 行。这样仍会保留冗长 arguments JSON，无法解决多文件读取时的噪音。

3. **解析器保持保守，失败即 fallback。**
   - 解析只识别 `--- <kind>: <path>` envelope、简单 `key: value` 字段、`entries:` 列表和 fenced block。任一关键结构不符合预期时，交给通用 renderer。
   - 这样历史记录、手写 tool record 或未来 handler 输出变化不会导致渲染异常。

4. **渲染复用现有工具消息视觉语言。**
   - `tool_call` 继续使用 `◆ ` 前缀和现有 call status 颜色。
   - `tool_result` 继续使用 `  ⎿ ` 起始前缀和 `    ` continuation 缩进，并复用当前 theme 的 tool output/token 样式。
   - 文本内容不做 Markdown 解析，保持文件读取内容的原样语义。

## Risks / Trade-offs

- **Envelope 解析与 handler 文本格式耦合** → 保持解析器小而保守，并为异常格式 fallback 到通用 renderer；测试覆盖代表性 envelope。
- **目录列表在窄终端中可能变宽或换行难读** → 使用现有 wrap/display width 工具限制行宽，必要时保持缩进换行，不输出超过 safe width 的行。
- **文本/PDF 内容可能很长** → 文本正文和 PDF 提取文本不进入终端投影，只在原始 tool result 中保留给模型使用。
- **路径或文件内容可能包含类似 envelope/fence 的文本** → 只在 top-level result 文本中按 envelope 边界解析；fenced block 内作为内容处理，不继续递归解析。
- **第一版没有结构化 metadata 的长期稳定性** → 如果未来 `read_files` 输出格式频繁演进，再考虑把解析结果下沉为 display metadata；本变更不阻塞该演进。
