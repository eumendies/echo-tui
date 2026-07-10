## 1. Render State And Shared Colors

- [x] 1.1 扩展 `StatusLineState`，把当前模型 label 与 `reasoningEffort` 拆分为独立字段，避免把 effort 拼进模型文本。
- [x] 1.2 更新 AppContext/RenderContext 的 status line 派生逻辑，传递当前 selected model 的显式 reasoning effort；未配置时不推断默认 effort。
- [x] 1.3 将 status line effort 圆点改为固定 cyan，并避免引入 status line 与 `/effort` slider 的共享颜色 helper。
- [x] 1.4 保持 `/effort` scale surface 的颜色逻辑自包含，避免普通 status line 反向依赖 slider 视觉语义。

## 2. Boxed Composer

- [x] 2.1 将普通输入态 composer 渲染为顶满 terminal safe render width 的 cyan 边框输入框，并保留当前 `> ` 输入前缀。
- [x] 2.2 在空 composer 内显示 dim placeholder，文案包含 `/` 命令入口、`Ctrl+J` 换行和 Enter 发送提示。
- [x] 2.3 确保 placeholder 只属于渲染态，不写入 composer state、transcript、input history 或 slash suggestion 匹配文本。
- [x] 2.4 调整 boxed composer 的 cursor row/column 偏移，覆盖普通输入、显式换行和自动 wrap 后的光标恢复。
- [x] 2.5 确保 composer 边框不显示 `Message` 或其他标题文字，并保持不写满终端最后一列。

## 3. Segmented Status Line

- [x] 3.1 将 status line 渲染改为左右分组的 segmented 单行结构，左侧显示模型、effort、目录，右侧显示 context usage 和当前状态。
- [x] 3.2 将真实 context usage 文案从 `ctx last <used>/<window>` 调整为 segmented `ctx <used>/<window>`，保留真实 provider 最近 usage 语义和紧凑 token 格式。
- [x] 3.3 实现 ready/idle、plan、thinking、streaming、tool 等状态 segment，保持 tool pending 显示工具名或等价标识。
- [x] 3.4 确保 status line 暂不显示 git branch。
- [x] 3.5 实现窄宽度裁剪策略：优先保留左侧模型、effort、目录，右侧动态状态可整体省略或裁剪，整行不超过 safe render width。
- [x] 3.6 保持 command、approval、user-question surface 替换普通 boxed composer 与 status line，不额外显示 context usage 或全局 status line。

## 3.5 User Transcript Quote Marker

- [x] 3.5.1 将已提交 user transcript block 的箭头前缀改为粗竖条 quote-style 前缀，并保留整行灰底。
- [x] 3.5.2 确保 user transcript block 的上下 padding 行同样显示粗竖条前缀并使用灰底。
- [x] 3.5.3 更新 user transcript 渲染测试和文档，保持 composer 输入前缀仍为 `> `。

## 4. Tests

- [x] 4.1 更新 footer renderer 测试，覆盖 boxed composer 顶满安全宽度、无 `Message` 标题、保留 `> ` 前缀和 placeholder 文案。
- [x] 4.2 增加 composer cursor 测试，覆盖空输入、非空输入、多行输入和自动 wrap 后的 cursor row/column。
- [x] 4.3 更新 status line 测试，覆盖 segmented 模型/effort/目录/context/state 渲染、无 git branch、`ctx <used>/<window>` 文案和紧凑 token 格式。
- [x] 4.4 增加 effort 颜色测试，验证 status line effort 圆点使用固定 cyan。
- [x] 4.5 更新 app/render context 测试，验证模型切换和 `/effort` 修改后 status line 的模型与 effort 分别更新。
- [x] 4.6 更新 command/approval/user-question surface 测试，验证这些 surface 替换普通 boxed composer/status line。

## 5. Docs And Validation

- [x] 5.1 更新 `docs/README.md`，说明 boxed composer placeholder 和 segmented status line 信息结构。
- [x] 5.2 更新 `docs/tui-architecture.md`，说明普通 footer 输入区、status line state 和固定 effort 圆点颜色策略。
- [x] 5.3 运行 `npm run typecheck`。
- [x] 5.4 运行 `npm test`。
- [x] 5.5 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [ ] 5.6 手动验证 `npm start` 下普通输入、空 placeholder、`Ctrl+J` 换行、Enter 提交、slash suggestion、streaming/pending、窄宽度 resize、command/approval/user-question surface 和 status line effort 固定圆点颜色。
