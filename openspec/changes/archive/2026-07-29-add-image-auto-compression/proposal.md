## Why

当前 File Picker／`@` mention 与模型调用 `read_files` 读取图片时，会直接把原始图片编码为附件；图片一旦超过 5 MB 上限便读取失败。为减少用户手工缩图步骤，并控制 provider 请求与 transcript 持久化体积，需要在统一图片读取链路中增加可配置的超限自动压缩能力。

## What Changes

- 为 PNG、JPEG、GIF 和 WebP 图片增加共享的附件准备流程：未超限图片保持原样，超限图片在开关启用时缩小并重新编码到最终附件上限以内。
- 让 File Picker／`@` mention 生成的 user 图片附件与 `read_files` 生成的 tool result 图片附件使用同一压缩策略和安全边界。
- 在 `/config`“常规”Tab 增加“超限图片自动压缩”开关，默认开启，并持久化到 `tools.readFiles.autoCompressImages`；关闭后恢复现有的超限失败行为。
- 压缩附件保留原路径和受支持媒体类型，并让附件大小、工具结果摘要及 transcript 中的 Base64 数据反映压缩后的内容；压缩失败时返回明确错误且不生成不完整附件。
- 引入 Sharp 作为运行时图片处理依赖，使用 npm 分发的平台预编译二进制，不要求用户预装 ImageMagick 或 libvips；项目 Node.js 引擎约束将与所选 Sharp 版本保持一致。
- **BREAKING**：最低 Node.js 版本由 `>=20` 精确提高到 `>=20.3.0`，以满足所选 Sharp 运行时版本的 engine 要求。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: `read_files` 读取超限图片时可按配置压缩并返回有效的 provider-neutral 图片附件。
- `composer-file-picker-context`: File Picker／`@` mention 提交超限图片时可按相同配置生成压缩后的 user 图片附件。
- `config-surface-settings`: `/config`“常规”Tab 新增图片自动压缩开关及其默认值、持久化和刷新语义。

## Impact

- 受影响代码包括 `src/tools/read-files/` 图片 reader、默认 tool registry 和运行时工具配置，`src/app/utils.ts` 的 mention 展开链路，AppSettings 读写与缓存，以及 config command state、handler 和 footer surface。
- `ToolResultImageAttachment.sizeBytes` 和压缩图片的 Base64 将表示实际发送的输出数据；provider adapters 无需改变现有附件投影协议。
- `package.json` 与 lockfile 将增加 Sharp 及其平台可选依赖；安装包体积会增加，并需验证 macOS、Linux、Windows 常见架构的安装行为。
- 需要补充图片处理、`read_files`、mention 展开、配置读写、配置交互和渲染测试；不改变文本、目录和 PDF 读取语义。
