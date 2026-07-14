## 1. Agent memory 存储与 scope

- [x] 1.1 定义 agent catalog、catalog scope、memory item、读写结果和四个 memory 工具参数/结果的共享类型。
- [x] 1.2 实现 `~/.echo/agent-memory/catalogs.json` 与按 catalog id 分离文件的版本校验、缺失语义、原子写入和无效文件保护。
- [x] 1.3 实现 global/project scope 过滤、规范化 project root、大小写不敏感名称唯一和 project 同名覆盖 global 的解析规则。
- [x] 1.4 实现 catalog/item 新增、更新、删除及删除最后一个 item 自动删除 catalog，并处理索引更新失败清理和 orphan 忽略。
- [x] 1.5 为存储创建/追加/重命名/删除、scope 隔离、同名覆盖、无效文件和写入失败补充自动化测试。

## 2. Provider catalog 索引与 context usage

- [x] 2.1 实现 agent catalog prompt formatter，只投影当前有效 catalog 的名称与描述，并声明持久内容的低优先级边界。
- [x] 2.2 在每次真实 provider request 构造时按当前 cwd 重读 agent catalog 索引，与 user memory、AGENTS.md 和 skill catalog 一起组成 transient system prompt。
- [x] 2.3 将 agent catalog 索引 token 计入现有 Memory context usage segment，同时保持 `read_memory` tool result 归入 Tools。
- [x] 2.4 为 scope 过滤、每轮重读、prompt 字段边界、索引变更生效和 context usage 分类补充自动化测试。

## 3. Memory 工具与审批

- [x] 3.1 实现 `read_memory` handler，支持读取 user memory 列表或有效 agent catalog items，并返回可供精确 mutation 的 item id。
- [x] 3.2 实现 `add_memory` handler，以 type 区分 user/agent；agent catalog 不存在时使用描述和默认 project scope 自动创建。
- [x] 3.3 实现 `update_memory` handler，支持 user item、agent catalog 元数据和 agent item 的严格目标校验与更新。
- [x] 3.4 实现 `remove_memory` handler，支持 user item、agent item 和 agent catalog 删除，并落实空 catalog 自动清理。
- [x] 3.5 将四个工具注册到默认 tool registry；将三个 mutation 工具接入现有风险分类、plan mode 限制和 tool approval，保持 `read_memory` 只读免审批。
- [x] 3.6 为 memory mutation 生成包含类型、scope、catalog/item 和内容/删除摘要的可读审批 preview，明确标记 global 写入。
- [x] 3.7 为工具 schema、参数错误、user/agent mutation、普通 tool continuation、拒绝结果和会话级审批复用补充自动化测试。

## 4. `/memory` 与 CommandHost 管理体验

- [x] 4.1 扩展 `CommandHost.memory` facade，通过当前 cwd 受控列出和修改 user memory、agent catalog 及 items。
- [x] 4.2 扩展 memory command surface/session 类型，表达 User/Agent 入口、scope、catalog/item 层级、编辑 target、删除确认和错误状态。
- [x] 4.3 扩展 `/memory` handler 状态机，保留 user memory 现有语义，并支持 agent catalog 浏览、进入 items、创建、原地编辑、删除和逐层 Esc 返回。
- [x] 4.4 扩展 memory footer renderer，显示 global/project scope、catalog 描述和 item 预览，并在所有编辑层级使用真实终端光标和安全宽高裁剪。
- [x] 4.5 处理保存失败草稿保留、删除最后一个 item 后返回 catalog 列表、索引刷新及 selection clamp。
- [x] 4.6 为 CommandHost facade、分层 handler 导航、user/agent 编辑删除、scope 展示、失败恢复和 renderer 光标/宽度补充自动化测试。

## 5. 文档与验证

- [x] 5.1 更新架构文档，说明两类 memory 的信任边界、存储位置、scope、catalog prompt、按需读取、工具审批和 `/memory` 管理方式。
- [x] 5.2 运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;` 和 `git diff --check`，修复发现的问题。
- [x] 5.3 手动验证 `/memory` 的 User/Agent 分层编辑、真实光标、scope 导航，以及 memory 工具审批、拒绝、读取 continuation 和下一轮 prompt 生效。
