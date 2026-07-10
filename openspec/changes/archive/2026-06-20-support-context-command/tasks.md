## 1. Context usage 数据模型与估算

- [x] 1.1 抽取或导出通用 token estimator，供 compaction 与 context breakdown 共同复用。
- [x] 1.2 扩展 `ContextUsage` 类型，增加 System prompt、Skills、Tools、Messages、Reasoning 分类 segments。
- [x] 1.3 实现 context usage breakdown 估算与 largest-remainder 校准逻辑，保证 segment token 总和等于 provider `usageInputTokens`。
- [x] 1.4 在 agent loop 构造 provider request 后生成 breakdown，并在 provider usage 返回后通过 `onContextUsage` 上报详细 usage。
- [x] 1.5 确保模型切换、配置保存、清空 transcript、恢复 session 等已有路径继续清理详细 context usage。

## 2. `/context` 命令与 CommandHost

- [x] 2.1 扩展 `CommandHost` 受控 facade，提供读取最近 context usage 的 context 领域能力。
- [x] 2.2 新增 `/context` command handler：有 usage 时打开详情 surface，无 usage 时打开提示 surface。
- [x] 2.3 将 `/context` 注册到默认 slash command handlers 和 slash suggestion descriptors。
- [x] 2.4 确保 `/context` 被本地命令消费，不触发 agent 请求、不追加 transcript record。

## 3. Context meter surface 渲染

- [x] 3.1 扩展 command surface 类型，新增只读 context usage surface。
- [x] 3.2 实现 demo 风格 context meter 渲染：卡片边框、header、window gauge、composition bar、分类 swatch 和明细行。
- [x] 3.3 实现 context surface 的关闭行为，任意非中断键或 Esc 关闭并回到普通 composer footer。
- [x] 3.4 保证小终端下渲染遵循安全宽度、最大行数和 footer redraw 约束。

## 4. 测试与验证

- [x] 4.1 添加 token estimator / breakdown 校准单元测试，覆盖分类求和、零估算和 rounding 修正。
- [x] 4.2 添加 agent loop 测试，覆盖 provider usage 上报时包含分类 breakdown，且 reasoning_summary 不计入 Reasoning。
- [x] 4.3 添加 command handler/runtime 测试，覆盖 `/context` 有 usage、无 usage、不触发 agent 请求和不追加 transcript。
- [x] 4.4 添加 footer/render 测试，覆盖 context surface 关键元素、小终端裁剪和 status line 仍只显示短文本。
- [x] 4.5 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。
