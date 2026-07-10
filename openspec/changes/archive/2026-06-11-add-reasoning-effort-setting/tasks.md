## 1. 配置与请求

- [x] 1.1 在共享类型中定义 reasoning effort 枚举和值集合：`none`、`minimal`、`low`、`medium`、`high`、`xhigh`。
- [x] 1.2 扩展 `src/config/llm-config.ts` 的 model profile 解析，支持 `models[].reasoning.effort` 并校验无效值。
- [x] 1.3 扩展运行时 `LlmConfig`，携带当前 selected model profile 的可选 reasoning effort。
- [x] 1.4 更新 `src/agent/openai-agent.ts` 的 request shape，在 effort 存在时发送 `reasoning: { effort }`，不存在时不发送 `reasoning`。
- [x] 1.5 更新配置解析和请求构造单元测试，覆盖有效 effort、无 effort 不发送、无效 effort 明确失败。

## 2. /effort 命令与持久化

- [x] 2.1 扩展模型配置上下文或新增 effort context，读取当前 selected model profile 的 effort 信息和 profile id。
- [x] 2.2 实现直接覆盖当前 model profile `reasoning.effort` 的原子写回，保留 profile 其他字段和 `reasoning` 未知字段。
- [x] 2.3 新增 `/effort` command handler，使用 scale surface 展示六个 effort 选项；无当前 effort 时初始选中 `medium`。
- [x] 2.4 将 `/effort` 注册到 slash command resolver、slash suggestions 和 command host 能力中。
- [x] 2.5 覆盖 `/effort` 的交互测试：打开、移动、确认写回、Esc 取消、配置错误、安全错误和 response lock 阻止。

## 3. Status Line 展示

- [x] 3.1 扩展 status line 需要的模型信息派生，读取当前 selected model profile 的显式 effort。
- [x] 3.2 更新 `AppContext.createStatusLineState()` 或等价组装逻辑，在模型展示文本中追加 `· effort <value>`。
- [x] 3.3 确保未配置 effort 时 status line 不显示 effort，不推断服务端默认值。
- [x] 3.4 更新 footer/status line 渲染测试，覆盖 effort 展示、无 effort 隐藏和窄宽度裁剪。

## 4. 文档与规格

- [x] 4.1 更新 `docs/README.md`，说明 `models[].reasoning.effort` 配置、合法值和 `/effort` 命令。
- [x] 4.2 更新 `docs/tui-architecture.md`，描述 reasoning effort 的配置归属、请求传递和 status line 展示。
- [x] 4.3 更新 slash 命令列表和手工验证清单，包含 `/effort`、status line effort 展示和请求携带 reasoning。

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`。
- [x] 5.2 运行 `npm test`。
- [x] 5.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 5.4 手工验证 `/effort` 在真实配置下可修改当前模型 profile，并让后续请求使用新推理等级。
