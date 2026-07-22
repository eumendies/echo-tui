## 1. 精简默认基础 prompt

- [x] 1.1 将 `BUILT_IN_SYSTEM_PROMPT` 精简为身份、回答风格、证据基础和非平凡多步骤任务管理规则
- [x] 1.2 移除内置 prompt 中的工具必要性、具体工具优先级和通用敏感信息提醒

## 2. SYSTEM.md 覆盖

- [x] 2.1 在 system prompt 模块中实现用户级与项目级 `SYSTEM.md` 加载、项目优先 fallback、内容规范化和完整读取
- [x] 2.2 将生效基础 prompt 接入 provider context，同时保留 cwd、AGENTS.md、skills 和 memory 拼接

## 3. 测试与文档

- [x] 3.1 更新单元和运行时集成测试，覆盖默认、用户级、项目级、fallback、动态 section 与 continuation 行为
- [x] 3.2 更新架构文档中的 system prompt 来源说明

## 4. 验证

- [x] 4.1 依次运行 typecheck、全量测试、JavaScript 语法检查、`git diff --check` 和 OpenSpec validate
