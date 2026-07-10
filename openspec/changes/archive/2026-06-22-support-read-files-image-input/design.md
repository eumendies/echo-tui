## Context

`read_files` 当前已经通过扩展名识别图片媒体类型，但在 `read-files-tool-handler` 中只允许 `kind: text` 继续读取；图片、PDF 等非文本资源会返回 unsupported metadata。与此同时，工具执行结果、transcript 记录以及 OpenAI / Anthropic provider converter 目前都以 `text: string` 为主要续传载体，不能表达“这次工具结果附带了一张模型应能看到的图片”。

本变更需要跨越三层边界：本地工具读取图片、transcript 持久化图片附件、provider adapter 将附件投影为各自 API 的视觉输入。设计目标是在不破坏现有文本读取和工具调用循环的前提下，引入一个足够小但可复用的多模态附件结构。

## Goals / Non-Goals

**Goals:**

- 让 `read_files` 对受支持图片格式返回 `ok: true`，并把图片作为模型可见附件发送给后续 provider continuation。
- 保持 `read_files` 的文本读取、行号分页、批量读取、`.git` 路径拒绝和输出截断语义不变。
- 让 TUI 和 tool result 文本只展示图片摘要与 metadata，不直接展示 base64 或二进制内容。
- 为 OpenAI Responses、OpenAI Chat Completions 和 Anthropic Messages provider 分别提供图片附件转换路径。
- 对图片格式和大小建立明确安全边界，超限或 provider 不支持时返回可诊断失败。

**Non-Goals:**

- 不支持 PDF、音频、视频或任意二进制文件的模型输入。
- 不实现图片压缩、缩放、OCR 或本地视觉理解。
- 不改变用户直接粘贴图片到 composer 的行为；该能力可在后续复用同一附件结构。

## Decisions

### 使用附件结构承载图片，而不是把 base64 写入 result text

`ToolExecutionResult` 和 `tool_result` transcript record 增加可选 `attachments` 字段，用于承载图片附件：`kind`、`mediaType`、`dataBase64`、`path`、`sizeBytes`。`text` 继续作为人类可读和 fallback provider 可读的 metadata 摘要。

替代方案是把 data URL 或 base64 直接拼到 `text`。该方案实现最少，但会污染 TUI、压缩上下文和 transcript 可读性，也容易被模型当作普通文本而非图片。因此选择附件结构。

### 第一版支持 PNG/JPEG/GIF/WebP，BMP 继续作为不支持图片格式处理

OpenAI 和 Anthropic 主流视觉输入均支持 PNG/JPEG/GIF/WebP；BMP 虽然当前 `guessMedia` 能识别，但 provider 支持不稳定。第一版只把 PNG/JPEG/GIF/WebP 作为可附加图片，BMP 返回明确 unsupported image media type。

### 图片读取忽略 offset/limit，但在结果文本中说明

`offset` 和 `limit` 只对文本行分页有意义。图片 file item 若携带这些字段，handler 不应额外失败，而应在图片 envelope 中标记它们对图片无效或已忽略。这沿用了现有 spec 中“未来非文本 reader 可忽略 offset/limit”的约束。

### Provider converter 负责把附件投影为 API 原生图片输入

工具 handler 不应知道 OpenAI 或 Anthropic 的请求结构。它只输出 provider-neutral 附件；OpenAI Responses converter 将附件转为可见图片输入，OpenAI Chat Completions converter 将附件转为 `image_url` content block，Anthropic converter 将附件转为 `image` content block。若某 provider 暂不支持该附件，converter 应保留文本 metadata，不应构造错误格式。

### 限制单张图片大小并保持总文本输出限制

新增单张图片读取上限，例如 `DEFAULT_MAX_IMAGE_BYTES`。图片附件体积与文本输出限制分开计算：`maxTotalOutputBytes` 仍只限制 result text，图片 bytes 由图片上限控制。这样可以避免 base64 被文本 cap 截断后产生不可用图片。

## Risks / Trade-offs

- 图片 base64 持久化会增大 session 文件 → 使用单张图片大小上限，并在 TUI 中只展示摘要；未来可再引入附件缓存或引用式存储。
- Provider API 对工具结果中图片 block 的支持形态不同 → 将转换逻辑封装在 provider converter 中，并用单元测试固定请求结构。
- OpenAI Responses 的 `function_call_output` 可能只接受字符串 → 设计上允许 converter 在 function output 后追加模型可见的用户图片输入块，确保工具结果文本和图片附件都进入同一续传上下文。
- 历史 transcript 没有附件字段 → `attachments` 为可选字段，旧 session 继续按纯文本路径转换。
- 不同 provider 支持的 image media type 不完全一致 → handler 只产出明确白名单格式；provider converter 可进一步按自身能力过滤或降级。

## Migration Plan

1. 扩展 provider-neutral 类型，新增图片附件结构，并保持字段可选以兼容旧 transcript。
2. 扩展 `read_files` 图片分支，读取受支持图片并返回 metadata + attachments；更新图片 unsupported 测试。
3. 扩展 transcript append / 工具结果记录路径，确保附件从 execution result 进入持久化记录。
4. 扩展 OpenAI Responses、OpenAI Chat Completions 和 Anthropic converter，将附件投影为模型可见图片输入。
5. 增加工具与 provider converter 单元测试；运行 typecheck 和测试套件。

回滚时可移除 converter 对附件的投影，保留 `text` metadata fallback；由于附件字段可选，旧数据结构不会阻断回滚后的纯文本运行。
