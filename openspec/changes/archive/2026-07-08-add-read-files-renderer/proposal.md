## Why

`read_files` 结果现在依赖通用 tool message renderer 展示，目录、文本、图片和 PDF 的 envelope 会以较原始的文本形式暴露，阅读成本偏高。为常用的只读文件工具增加专属 renderer，可以让用户更快识别读取了哪些路径、每个结果的类型、分页/截断状态和关键元数据。

## What Changes

- 为 `read_files` tool call 增加专属调用行展示，使用原始 snake_case 工具名并摘要展示路径、offset 和 limit。
- 为 `read_files` tool result 增加专属结果投影，按 text、directory、image、pdf、unsupported/error 等 envelope 类型展示更清晰的头部和内容。
- 专属 renderer 只影响终端可见投影，不改变 `read_files` tool result 文本、附件、transcript 记录或 provider-visible 语义。
- 当 `read_files` 结果无法按预期 envelope 解析时，渲染层继续安全降级到通用 tool renderer。

## Capabilities

### New Capabilities
- `tool-message-rendering`: 定义 transcript 中工具调用和工具结果的终端专属投影行为，包含 `read_files` 的结构化展示要求与安全降级规则。

### Modified Capabilities

## Impact

- 影响 `src/render/tool-message-renderer.ts` 及新增或调整的 tool-specific renderer 模块。
- 影响 `test/render/app-renderer.test.js` 或相关渲染测试，覆盖 `read_files` 的文本、目录、图片/PDF/错误和 fallback 场景。
- 不改变 `src/tools/read-files` 的执行语义、结果 schema、附件传递方式或本地文件读取边界。
