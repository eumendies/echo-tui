## 1. LLM 配置解析与类型

- [x] 1.1 扩展 `src/agent/llm-config.ts` 的配置解析，支持 `llm.models` / `llm.selectedModel`，并保持缺少必要字段时明确失败。
- [x] 1.2 为模型 profile 定义清晰类型，支持 `id`、`label`、`model`、可选 `apiKey`、可选 `baseURL`，并实现顶层 provider 配置继承与 profile 覆盖。
- [x] 1.3 保持 `readLlmConfig()` 对 `openai-agent.ts` 的输出 contract 稳定，确保真实 adapter 仍只接收最终生效的 `{ apiKey, baseURL, model }`。
- [x] 1.4 新增配置读取单元测试，覆盖多模型选中、缺省 selectedModel 使用首个有效 profile、selectedModel 指向已删除 profile 时使用首个有效 profile、缺少 models、profile 继承/覆盖和敏感信息脱敏。

## 2. 模型列表与持久化选择

- [x] 2.1 扩展 `src/app/model-context.ts`，提供 `/model` 所需的候选模型列表、当前选中 profile 和安全错误摘要。
- [x] 2.2 实现 `selectModel(id)` 或等价能力，读取完整 `config.json`、保留未知字段、只更新 `llm.selectedModel`，并使用临时文件 + rename 原子写入。
- [x] 2.3 处理写入失败、配置无效和无可选 profile 的错误路径，所有用户可见错误必须经过敏感信息脱敏。
- [x] 2.4 新增 ModelContext 单元测试，覆盖模型列表派生、当前选中项、高亮初始项、持久化写回、未知字段保留、写入失败和缺少 models 不写入。

## 3. /model select command surface

- [x] 3.1 修改 `src/commands/model-command-handler.ts`，在多模型配置下打开 `select` surface，复用 `/resume` 的 Up/Down/Enter/Esc 交互模式。
- [x] 3.2 在配置缺失或配置错误时继续打开安全 `info` surface，展示可操作错误摘要。
- [x] 3.3 Enter 确认时调用 ModelContext 持久化选择；成功后关闭 command session 并清空 composer，失败时保留或更新为错误 surface。
- [x] 3.4 确保 `/model` 命令不启动真实 agent、不写 transcript、不进入输入历史，并在 response 进行中继续被阻止。
- [x] 3.5 更新 slash command 测试，覆盖纯 `/model` 匹配、select surface 初始项、方向键移动、Enter 持久化、Esc 取消、失败错误和非纯 `/model` 回退普通消息。

## 4. 集成、文档与验证

- [x] 4.1 更新 `docs/README.md` 的配置示例和命令说明，展示多模型 profile 配置方式。
- [x] 4.2 更新 `docs/tui-architecture.md`，说明 `llm-config`、`ModelContext`、`/model` handler 和 command surface 的新职责边界。
- [x] 4.3 运行并通过 OpenSpec strict validate，确认 delta specs 与 tasks 状态正确。
- [x] 4.4 运行 `npm run build`、`npm run typecheck`、`npm test`、JS syntax check 和 `git diff --check`。
- [x] 4.5 做轻量手工验证：缺少 models 打开 `/model`、多模型配置切换、切换后下一次请求使用新模型、Esc 取消不写配置。
