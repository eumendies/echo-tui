## 1. 依赖与配置模型

- [x] 1.1 将 `sharp@^0.34.5` 加入运行时依赖、更新 lockfile，并把 `engines.node` 精确调整为 `>=20.3.0`
- [x] 1.2 在 AppSettings 中增加默认开启的 `autoCompressImages`，实现 `tools.readFiles.autoCompressImages` 的容错读取、严格草稿校验、原子保存及未知字段保留
- [x] 1.3 扩展 `ToolRuntimeConfig` 和 LLM 配置读取，使每轮默认 tool registry 能获得相同的归一化图片压缩开关
- [x] 1.4 更新配置单元测试，覆盖有效值、缺失／非法值回退、保存新字段及保留 `tools` 其他节点

## 2. 共享图片附件准备

- [x] 2.1 将图片读取边界改为异步策略接口，区分 5 MB 最终附件上限、50 MB 源文件上限与自动压缩开关，同时保持未超限图片原始字节不变
- [x] 2.2 使用延迟加载的 Sharp 实现 JPEG、PNG 和 WebP 的方向校正、等比缩放、原格式重编码及有限次字节上限收敛
- [x] 2.3 实现动态 GIF 的保帧缩放与原格式重编码，并对源 bytes、解码像素、最小尺寸和最大尝试次数应用安全边界
- [x] 2.4 让成功压缩的附件使用输出 Base64 和 size bytes，并为加载失败、解码失败、安全边界超限及无法收敛提供明确且不泄漏二进制的错误
- [x] 2.5 增加图片处理测试，覆盖未超限直通、各支持格式超限压缩、GIF 动画保留、关闭开关、源／像素上限、压缩失败和附件最终大小

## 3. read_files 与 mention 集成

- [x] 3.1 将运行时图片压缩设置传入 `read_files` handler，并让批量读取按输入顺序串行处理图片、保留成功附件顺序和部分失败语义
- [x] 3.2 更新 `read_files` 图片结果摘要，使压缩结果展示原始大小、输出大小和压缩标记，未压缩结果保持现有简洁格式
- [x] 3.3 从 AppContext 暴露当前图片压缩设置并传入 File Picker／`@` mention 展开，使 user transcript 只持久化处理后的图片附件
- [x] 3.4 更新工具执行与 app utils 测试，覆盖 `read_files` 和 mention 在开关两种状态下的超限行为、重复 mention 去重及失败时不生成附件
- [x] 3.5 验证 OpenAI Responses、OpenAI Chat 和 Anthropic converter 无需协议变更即可发送压缩后的 user/tool 图片附件，并补充必要的回归断言

## 4. Config surface 交互

- [x] 4.1 在常规配置行、surface 投影和 footer 渲染中增加“超限图片自动压缩”开关，避免与上下文“自动压缩阈值”混淆
- [x] 4.2 支持 Left、Right 和 Enter 切换图片压缩草稿，并纳入 dirty fingerprint、保存反馈和统一放弃确认
- [x] 4.3 刷新 AppSettings 后让后续 mention 立即使用新值，并保持当前 active tool registry 不变、下一轮 `read_files` 生效且不触发多余重绘或 context usage 清理
- [x] 4.4 更新 config command、command host、AppContext 和 config surface 渲染测试，覆盖开关导航、切换、保存、刷新生命周期及窄／矮终端窗口

## 5. 验证与文档

- [x] 5.1 更新用户配置示例或相关文档，说明 `tools.readFiles.autoCompressImages` 默认值、作用范围、关闭后的超限失败语义及 Sharp 无需系统预装
- [x] 5.2 运行 `npm run typecheck` 并修复所有类型错误
- [x] 5.3 运行 `npm test` 并修复所有测试失败
- [x] 5.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 并确认 JavaScript 语法检查通过
