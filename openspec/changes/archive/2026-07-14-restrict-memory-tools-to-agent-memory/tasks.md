## 1. 收敛 memory tool 契约

- [x] 1.1 更新四个 memory tool definitions，移除 `type`，将 agent memory 的公共字段设为正确的 required/optional 参数，并重写仅面向 agent memory 的工具描述
- [x] 1.2 重构 memory tool handler，删除 user memory store 依赖、`parseType` 和 user 分支，直接执行 agent catalog/item 读写
- [x] 1.3 从成功 tool result 中移除冗余的 `type: agent`

## 2. 更新审批与终端投影

- [x] 2.1 更新 memory mutation 审批 preview，移除 Type 行并保留 global scope、catalog、target、item 和内容摘要
- [x] 2.2 更新 memory tool renderer，仅根据 catalog、target 和 content 生成 agent memory 摘要，并保留 malformed payload 的安全 fallback

## 3. 更新自动化测试

- [x] 3.1 更新 memory tool handler 测试，覆盖无 `type` 的 catalog/item CRUD、required schema 和成功结果结构
- [x] 3.2 增加 agent memory 工具调用不读取或修改 `~/.echo/memories.json` 的回归测试
- [x] 3.3 更新 tool approval、agent tool registry 和 renderer 测试，移除 user memory tool 预期并验证新的 agent-only 摘要

## 4. 文档与验证

- [x] 4.1 更新架构文档，明确 user memory 仅由 `/memory` 管理、agent memory 由 tools 与 `/memory` 管理
- [x] 4.2 运行 `npm run typecheck`、`npm test` 和 JavaScript 批量语法检查
