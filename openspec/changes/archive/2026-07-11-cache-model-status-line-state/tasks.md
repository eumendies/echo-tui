## 1. ModelContext 缓存模型展示状态

- [x] 1.1 为 `ModelContext` 增加实例级模型状态缓存，保存模型列表、selected index、status line model label、reasoning effort 和安全错误状态。
- [x] 1.2 增加刷新模型状态的方法，基于 `readLlmModelConfigInfo()` 读取写入后的配置并更新缓存；读取失败时保存可渲染的 unavailable/error 状态。
- [x] 1.3 增加纯内存读取方法，供 status line 派生当前模型 label 和 reasoning effort，确保该方法不读取或解析 `~/.echo/config.json`。
- [x] 1.4 调整 `/model`、`/effort` 命令信息读取路径，使显式打开命令 surface 时可以刷新配置并同步更新缓存。

## 2. Render 与应用内写入路径集成

- [x] 2.1 调整 `AppContext.createStatusLineModelState()`，让普通 footer/status line render 从 `ModelContext` 缓存读取模型展示状态。
- [x] 2.2 调整 `AppContext.createRenderState()` 或相关调用路径，在 command surface 打开时避免无意义创建普通 status line 模型状态。
- [x] 2.3 在 `/model` 选择成功写入 `llm.selectedModel` 后刷新 `ModelContext` 模型状态缓存，并保持清空 context usage 的既有行为。
- [x] 2.4 在 `/effort` 成功写入当前模型 `reasoning.effort` 后刷新 `ModelContext` 模型状态缓存。
- [x] 2.5 在 `/config` 保存配置草稿成功后刷新 `ModelContext` 模型状态缓存，并保持清空 context usage 的既有行为。
- [x] 2.6 确认 agent loop 仍在每轮普通请求中通过 `readLlmConfig()` 读取运行时配置，不复用 status line 缓存。

## 3. 测试覆盖

- [x] 3.1 增加或更新 `ModelContext`/`AppContext` 测试，验证高频 `createRenderState()`/status line 派生只读取缓存，不重复读取用户配置文件。
- [x] 3.2 增加 `/model` 成功切换后 status line 使用新模型 label 的回归测试。
- [x] 3.3 增加 `/effort` 成功修改后 status line 使用新 reasoning effort 的回归测试。
- [x] 3.4 增加 `/config` 保存成功后刷新 status line 模型展示状态的回归测试。
- [x] 3.5 增加写入失败不更新模型状态缓存的测试，确保 UI 不显示未持久化状态。
- [x] 3.6 增加或保留 agent 配置读取测试，确认本次缓存不改变后续 provider 请求使用新配置的语义。

## 4. 文档与验证

- [x] 4.1 更新相关架构文档，说明 status line 模型状态由 `ModelContext` 缓存，render path 不读取用户配置文件。
- [x] 4.2 运行 `npm run typecheck`。
- [x] 4.3 运行 `npm test`。
- [x] 4.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 4.5 运行 `git diff --check`。
