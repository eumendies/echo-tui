## 1. Prompt 定义与运行时注入

- [x] 1.1 新增内置 system prompt 常量模块，内容覆盖 Echo TUI agent 身份、简洁回答、工具使用边界和终端交互约束。
- [x] 1.2 在 agent loop runtime 中创建 provider records，先注入 transient `system` record，再接调用方传入的 `TranscriptRecord[]`。
- [x] 1.3 确保 tool-call continuation 基于已注入 system prompt 的 provider records 继续追加 assistant segment、tool_call 和 tool_result records。
- [x] 1.4 确认注入逻辑不修改调用方传入 records，不通过 app callbacks 追加 system record，也不影响 fake/stub `RunAgent` 注入路径。

## 2. 不可覆盖约束

- [x] 2.1 保持 `readLlmConfig` 不读取 `systemPrompt`、`prompt` 或类似用户配置字段。
- [x] 2.2 保持模型 profile 不支持 system prompt override，避免 `/model` 或用户配置改变内置 prompt。
- [x] 2.3 确认 OpenAI provider agent 不自行生成 prompt，也不从配置中读取 prompt；只转换 runtime 传入 records 中已有的 `system` record。

## 3. 测试覆盖

- [x] 3.1 更新 agent loop runtime 单测，覆盖首轮 provider records 以 system record 开头。
- [x] 3.2 更新 agent loop runtime 单测，覆盖工具调用后的 continuation provider records 仍保留同一条 system record。
- [x] 3.3 增加或更新测试，确认调用方传入的 transcript records 没有被注入逻辑原地修改，且 callbacks 不暴露 system record。
- [x] 3.4 增加或更新 OpenAI 集成测试，确认 OpenAI request input 包含内置 system message。
- [x] 3.5 增加或更新配置测试，确认用户配置中的 `systemPrompt` 或 profile prompt 字段不会影响真实请求使用的内置 prompt。

## 4. 文档与验证

- [x] 4.1 同步 docs 和主 spec 的当前契约描述，只写内置 system prompt 现状，不写迁移前后叙述。
- [x] 4.2 运行 `npm run typecheck`、`npm test` 和批量 `node --check`，确认编译、测试和 JS 语法检查通过。
- [x] 4.3 回填本 tasks 清单并运行 OpenSpec validate，确认 change 可 apply 和后续 archive。
