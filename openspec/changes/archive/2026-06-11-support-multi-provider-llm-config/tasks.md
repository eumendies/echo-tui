## 1. 配置解析模型

- [x] 1.1 在 `src/config/llm-config.ts` 中定义 provider profile 解析所需的内部类型和校验函数。
- [x] 1.2 实现 `llm.providers` 读取逻辑，校验 provider id 唯一性、provider 对象结构、`agentType`、`apiKey` 和 `baseURL` 字段。
- [x] 1.3 调整 model profile 解析：当存在 `llm.providers` 时要求 `models[].provider` 为有效字符串，并引用已定义 provider。
- [x] 1.4 删除无 `llm.providers` 时的 legacy 解析路径，不再支持顶层和 profile 级 provider 字段继承与覆盖。
- [x] 1.5 保持 `readLlmConfig()` 输出的运行时 `LlmConfig` 形状稳定，只返回当前生效的扁平 provider 和 model 配置。

## 2. 模型选择与错误处理

- [x] 2.1 更新 `readLlmModelConfigInfo()`，确保 provider-backed model profile 可被 `/model` 列表读取和展示。
- [x] 2.2 确认 `ModelContext.selectModel()` 仍只写回 `llm.selectedModel`，不自动改写 provider map 配置结构。
- [x] 2.3 为缺少 provider、provider 引用不存在、provider-backed model 缺少 `provider`、openai provider 缺少 `apiKey` 等场景提供安全错误信息。
- [x] 2.4 确认 fake provider 不要求真实 `apiKey`，并继续生成 fake agent 可用的占位凭据。

## 3. 测试覆盖

- [x] 3.1 更新 `test/config/llm-config.test.js`，覆盖多 provider 多 model 解析、selectedModel 命中、缺省 selectedModel、stale selectedModel 和 contextWindow 保留。
- [x] 3.2 增加 provider 配置错误测试，覆盖缺少 provider 字段、引用不存在 provider、provider 字段类型错误和 openai provider 缺少 apiKey。
- [x] 3.3 更新测试确认缺少 `llm.providers` 时明确失败，旧的顶层共享配置和 profile 覆盖配置不再解析。
- [x] 3.4 更新或补充 `test/app/model-context.test.js`，覆盖 provider-backed 配置下 `/model` 列表读取和 `selectedModel` 写回。

## 4. 文档与规格

- [x] 4.1 更新 `docs/README.md` 的 LLM 配置示例，展示 `llm.providers` 与 `models[].provider` 推荐结构。
- [x] 4.2 更新 `docs/tui-architecture.md` 中 LLM config 说明，描述 provider map、model profile 和运行时扁平配置的关系。
- [x] 4.3 在文档中说明 `llm.providers` 是唯一生效结构，legacy 字段不再读取。

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`。
- [x] 5.2 运行 `npm test`。
- [x] 5.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 5.4 手工验证 `/model` 在 provider-backed 配置下能展示模型、切换模型，并让下一次请求使用新 provider 和模型配置。

## 6. Provider Headers 补充

- [x] 6.1 支持 provider-backed 配置中的 `headers` 字段解析。
- [x] 6.2 将运行时 `headers` 传给 OpenAI SDK `defaultHeaders`。
- [x] 6.3 为 provider headers 和 SDK client headers 传递增加测试。
- [x] 6.4 更新文档与用户级 `~/.echo/config.json`，新增 LLMBox provider 和模型。
