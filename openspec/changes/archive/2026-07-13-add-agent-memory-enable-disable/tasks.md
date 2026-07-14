## 1. 扩展 agent memory 存储模型

- [x] 1.1 为 `AgentMemoryCatalog` 和 `AgentMemoryItem` 增加必需的 `enabled` 字段，新建 catalog/item 默认写入 `true`，并保持存储 `version: 1`。
- [x] 1.2 更新索引与 catalog 文件解析，严格拒绝缺少 boolean `enabled` 的开发期旧格式，同时保留现有原子写入和无效文件保护。
- [x] 1.3 增加 catalog/item enabled setter；item 切换时更新 `updatedAt`，catalog 切换不改变名称、描述或 scope。
- [x] 1.4 增加 agent 有效 catalog 读取路径：过滤 disabled catalog、先选 enabled project 再回退 enabled global，并只返回 enabled items；管理读取继续返回全部数据。
- [x] 1.5 更新 agent memory store 测试，覆盖默认启用、严格格式校验、启停持久化、同名 fallback、显式 scope 拒绝和 disabled item 过滤。

## 2. 接入 provider 与 memory tool

- [x] 2.1 让 provider catalog 投影使用过滤后的有效 catalog，确保 disabled catalog 不进入 system prompt、debug count 或 memory token 估算。
- [x] 2.2 更新 agent `read_memory` 执行路径，拒绝 disabled catalog 并排除 disabled items，同时保持四个 tool 的公开参数 schema 和 mutation 审批规则不变。
- [x] 2.3 更新 memory tool 与 agent runtime 测试，覆盖下一轮 prompt 启停生效、project/global fallback、显式 disabled scope 失败和 tool result 过滤。

## 3. 扩展 `/memory` 管理界面

- [x] 3.1 在 `CommandHost` memory facade 与共享 command 类型中增加 agent catalog/item enabled setter，并使用当前 cwd 调用存储层。
- [x] 3.2 在 agent catalog 和 item 列表中支持 Space 切换 enabled 状态，成功后同步当前 surface 与 session cache，失败时保留原状态并展示错误。
- [x] 3.3 在 catalog/item 行渲染启停 toggle 并更新操作提示；一级 global/project count 继续统计全部 enabled/disabled items。
- [x] 3.4 更新 command host、memory command handler 和 memory surface 测试，覆盖两层 toggle、cache 更新、失败保持、全部 item 计数和 disabled 状态展示。

## 4. 验证与文档

- [x] 4.1 检查并更新受 agent memory JSON shape 影响的 fixtures、测试快照和架构文档描述。
- [x] 4.2 依次运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 4.3 手动验证 `/memory` 中 global/project catalog 与 item 的启停、真实 toggle 展示、返回导航和 session cache；验证下一次 provider prompt 与 `read_memory` 的 disabled/fallback 行为。
