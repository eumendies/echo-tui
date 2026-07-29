## Context

当前 `read_files` 与 File Picker／`@` mention 最终都通过 `src/tools/read-files/readers.ts` 和 `image-reader.ts` 生成 `ToolResultImageAttachment`。reader 在读取 Base64 前以源文件大小和固定的 5 MB `maxImageBytes` 比较：未超限时直接读取原始字节，超限时返回失败。user record 和 tool result 随后复用同一 provider-neutral 附件类型，但两条入口的配置来源不同：TUI mention 使用 AppContext 缓存的 AppSettings，模型工具 registry 则在每轮 agent 准备阶段根据运行时配置创建。

本变更跨越图片处理、工具 registry、TUI 提交、配置 surface 和安装依赖。压缩必须发生在附件进入 transcript 之前，否则原始 Base64 仍会放大会话 journal；同时不能让图片解码阻塞文本、目录或 PDF 读取，也不能因平台图片二进制不可用而使整个 CLI 无法启动。

## Goals / Non-Goals

**Goals:**

- 对 File Picker／`@` mention 和 `read_files` 使用一致的超限图片压缩规则。
- 未超过 5 MB 的图片保持字节不变；超过上限时在配置开启的前提下生成不超过最终上限的附件。
- 支持当前已接受的 PNG、JPEG、GIF 和 WebP，保留媒体类型；GIF 压缩时保留动画帧。
- 提供默认开启、可在 `/config` 中编辑的持久化开关，并让 TUI 与 headless 工具运行共享配置。
- 限制源文件大小、解码像素、处理次数和并发内存，并提供明确失败信息。
- 通过 npm 安装 Sharp 的平台预编译依赖，不要求用户预装系统图片工具。

**Non-Goals:**

- 不压缩未超出附件大小上限的图片，也不提供质量、尺寸、输出格式或目标字节数的高级用户配置。
- 不改变 provider adapter 的图片 block 协议，不新增远程图片下载、OCR、图片预览或 PDF 页面图片化。
- 不把图片转换为另一种媒体类型，不使用外部 ImageMagick 命令，也不把压缩结果写回用户原文件。
- 不保证任意恶意或极端图片都能成功压缩；违反源文件或解码安全边界时应明确失败。

## Decisions

### 使用共享的异步图片附件准备边界

将现有只负责校验和同步读取的图片 reader 演进为共享异步准备流程，由 `readOneFile` 传入图片策略：最终附件上限、源文件安全上限以及是否自动压缩。两条入口继续复用 `readOneFile`，但分别显式传入同一个归一化配置值。

```text
File Picker / @ mention ── AppSettings ──┐
                                        ├─ readOneFile
read_files ── ToolRuntimeConfig ─────────┘       │
                                                  ▼
                                      prepareImageAttachment
                                       ├─ 原样附件
                                       ├─ 压缩附件
                                       └─ 明确失败
```

这样可以避免两套压缩算法和媒体检测，同时保持 `read_files` handler 的 provider-neutral 返回结构。备选方案是在 provider converter 中压缩，但该方案发生得太晚，原始 Base64 已进入 transcript；另一备选是在 mention 层单独压缩，会遗漏工具附件并造成行为分叉。

### 仅对超限图片压缩，并区分源文件与最终附件上限

保留 5,000,000 bytes 作为最终附件硬上限。文件不超过该值时直接读取原始字节，避免无意义的质量损失和 CPU 开销。文件超过最终上限且开关关闭时维持现有失败语义；开关开启时才交给 Sharp。

新增独立的源文件安全上限，初始值采用 50,000,000 bytes。超过源上限的文件在解码前失败。Sharp 同时配置有限的输入像素上限；多文件读取按输入顺序串行准备图片，避免多个大图同时占用解码内存。源上限是内部安全常量，不在第一版 Config surface 暴露。

### 使用 Sharp 原内存缩放并保持媒体类型

增加 `sharp@^0.34.5` 运行时依赖，并将 `engines.node` 调整为 `>=20.3.0`。npm 会根据平台安装预编译的 Sharp/libvips 可选包，常见 macOS、Linux、Windows 的 x64/arm64 用户无需预装系统库。图片处理模块延迟加载 Sharp；若平台包缺失或加载失败，仅当前超限图片返回“图片压缩不可用”错误，文本和未超限图片读取不受影响。

压缩流程读取 metadata 并应用 EXIF 方向，使用 `fit: inside` 保持宽高比。初始缩放比例结合源字节数平方根和 4096 像素长边上限估算；按原媒体类型重新编码，并以最终上限的 90% 作为目标留出编码波动余量。若输出仍超过 5 MB，则在有限次数内按固定比例继续缩小尺寸并重新编码。JPEG/WebP 使用固定的平衡质量，PNG 使用高压缩级别，GIF 以 animated 模式读取并保留全部帧。达到最小尺寸、最大尝试次数或处理安全边界后仍超限时返回失败，不生成部分附件。

保持媒体类型可以避免透明通道或动画语义因自动格式转换而丢失。备选方案是统一转 WebP，通常体积更小，但会改变附件类型、GIF 动画兼容性和用户对原格式的预期，因此不采用。

### 压缩结果成为唯一持久化和发送的数据

成功压缩后，附件 `dataBase64` 和 `sizeBytes` 使用输出 buffer，`path` 保留用户选择的原路径，`mediaType` 保持原类型。`read_files` 文本摘要对压缩图片增加原始大小、输出大小和已压缩标记；未压缩图片维持现有简洁摘要。mention 的 provider-facing 文本仍只说明路径和图片已附加，不暴露 Base64 或冗长处理 metadata。

user transcript record 与 tool result transcript record 都只接收处理后的附件，因此 provider converter、session journal 和恢复流程无需新增附件变体。压缩失败时沿用现有 file envelope 错误路径，且不得产生附件。

### 配置归属 `tools.readFiles`，两类运行时按现有生命周期读取

新增布尔配置 `tools.readFiles.autoCompressImages`，默认 `true`。AppSettings 负责 Config surface 草稿、TUI 缓存和 mention 提交；`ToolRuntimeConfig` 负责每轮创建 `read_files` handler。两处归一化都对缺失或非布尔值独立回退默认值。

配置中心保存后，File Picker／mention 使用刷新后的 AppContext 缓存；当前 active assistant run 的工具 registry 保持启动时快照，下一轮重建 registry 后使用新值。这与现有文件编辑工具模式的生命周期一致。该开关不改变 tool definition schema，因此变化时无需完整 transcript 重绘或清空 context usage。

## Risks / Trade-offs

- [Sharp 增加安装体积，平台可选依赖可能被 `--omit=optional` 跳过] → 声明为直接运行时依赖、记录常规安装要求，并延迟加载以让失败局限于超限图片压缩。
- [最低 Node.js patch 版本提高] → 在 `package.json` 中明确 `>=20.3.0`，构建和安装测试验证 engine；发布说明标注该变更。
- [解压缩炸弹或动态 GIF 占用大量内存] → 在读取前限制源 bytes，在 Sharp 中限制输入像素，串行处理图片并限制迭代次数；越界直接失败。
- [按字节估算不能一次命中目标] → 预留 10% 余量并有限次逐步缩小，以最终 buffer bytes 作为唯一成功判定。
- [有损重编码降低文字截图或照片质量] → 仅处理超限图片，优先缩小尺寸并使用固定平衡质量；用户可关闭开关恢复显式失败并自行处理原图。
- [动态 GIF 重编码成本高或仍无法达标] → 保留帧和格式但应用相同源文件、像素、尝试次数与最终大小边界；无法安全达标时返回明确失败。
- [AppSettings 与 ToolRuntimeConfig 分别解析同一字段可能漂移] → 共享默认常量和布尔归一化语义，并用配置及 TUI/headless 集成测试锁定一致性。

## Migration Plan

1. 增加 Sharp 依赖并对齐 Node engine，先验证受支持平台的安装、加载和基础图片处理。
2. 引入共享图片准备流程与安全上限，在默认关闭策略下验证现有 reader 行为，再接入开关。
3. 扩展 AppSettings、ToolRuntimeConfig、默认 tool registry 和 mention 调用链，默认缺失配置归一化为开启。
4. 增加 Config surface 行和持久化逻辑；已有配置文件无需迁移，首次保存常规设置时写入新字段。
5. 如需回滚运行行为，用户可将 `tools.readFiles.autoCompressImages` 设为 `false`；代码版本回滚后未知的 `tools.readFiles` 字段会被现有配置保留且忽略。

## Open Questions

无。第一版固定最终上限、源文件安全上限、编码参数和默认开启策略；实际使用数据表明需要更细粒度控制时再单独提案。
