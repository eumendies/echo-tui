## Why

当前 `read_files` 工具只能读取 UTF-8 文本文件；虽然能识别图片扩展名，但会把图片作为不支持的媒体类型返回，导致模型无法通过工具查看本地截图、设计稿或其他图片资料。

让 `read_files` 能读取图片并作为多模态输入发送给大模型，可以让用户直接要求模型分析本地图片文件，而不需要额外上传或手动转述图片内容。

## What Changes

- `read_files` 支持读取受支持图片格式，并在工具结果中返回图片元数据和可供 provider 发送的图片附件。
- 工具执行结果与 transcript 记录支持携带图片附件，同时保持面向用户的 TUI 展示为简洁文本摘要，避免直接显示 base64。
- OpenAI Responses 和 OpenAI Chat Completions provider 在续传带图片附件的 `read_files` 工具结果时，把图片作为模型可见的视觉输入发送。
- Anthropic Messages provider 在续传带图片附件的 `read_files` 工具结果时，把图片作为模型可见的 image content block 发送。
- 为图片大小、格式和安全边界增加明确失败语义；文本读取、行号分页、`.git` 路径拒绝和现有工具调用行为保持不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 扩展 `read_files` 的媒体读取能力和工具结果语义，使图片文件可作为附件返回。
- `streaming-llm-service-adapter`: 扩展 provider-neutral transcript 到 OpenAI Responses / Chat Completions 输入的转换，使图片工具结果能作为视觉输入发送给模型。
- `anthropic-compatible-llm-adapter`: 扩展 Anthropic transcript 转换，使图片工具结果能作为 Anthropic image block 发送给模型。

## Impact

- 影响 `src/tools/read-files-tool-handler.ts` 的媒体类型处理、图片读取、大小限制和结果格式。
- 影响 `src/types/tool.ts` 与 `src/types/transcript.ts` 的工具结果 / transcript 类型，以承载图片附件。
- 影响 OpenAI Responses、OpenAI Chat Completions 与 Anthropic transcript converter，将附件转换为各自 provider 支持的图片输入结构。
- 影响工具结果渲染与持久化路径；TUI 应显示图片摘要，不展示完整二进制或 base64。
- 需要更新 `read_files` 工具测试，以及 OpenAI / Anthropic provider converter 测试。
