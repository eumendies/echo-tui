## 1. Tool schema 与解析

- [x] 1.1 新增 `ask_user_questions` 工具模块，定义 tool name、function schema、参数类型和结果构造 helper。
- [x] 1.2 实现参数解析与校验：`questions[]` 非空、每题 `question` 非空、每题 options 非空、option label 非空。
- [x] 1.3 将 `ask_user_questions` 注册到默认 tool registry，使 provider request 能携带该工具 schema。

## 2. Agent loop interactive tool 支持

- [x] 2.1 在 agent callback 类型中新增用户问题交互 callback，返回 `ToolExecutionResult`。
- [x] 2.2 在 agent loop runtime 中识别 `ask_user_questions`，通过用户问题 callback 执行，避免交给普通 executor。
- [x] 2.3 保持 tool call/result transcript continuation 语义不变：用户回答或取消后都作为 tool result 进入后续模型请求。
- [x] 2.4 增加 agent loop 单元测试，覆盖 interactive tool 不调用 executor、成功回答继续、取消结果继续。

## 3. App 层用户问题交互

- [x] 3.1 新增 `UserQuestionContext`，管理 active request、当前题索引、当前选项索引、已选答案和 Promise resolve。
- [x] 3.2 将当前题投影为 `ChoiceCommandSurface`，逐题显示问题、选项、description 和题目进度。
- [x] 3.3 处理输入事件：Up/Down 移动选项，Enter 确认当前题并进入下一题或完成，Esc 取消整个工具请求。
- [x] 3.4 将 `UserQuestionContext` 接入 app render surface 和输入事件优先级，并在 agent callbacks 中 wiring 用户问题请求。

## 4. 测试与验证

- [x] 4.1 增加 app 层测试，覆盖单题选择、多题逐题选择、description 显示和 Esc 取消。
- [x] 4.2 增加 tool schema/parser 测试，覆盖有效参数和无效参数。
- [x] 4.3 更新 registry/schema 测试，确认默认 registry 暴露 `ask_user_questions`。
- [x] 4.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。
