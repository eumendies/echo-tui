## 1. 有效 agent memory 聚合读取

- [x] 1.1 扩展 memory 类型，定义有效 catalog 与 enabled items 成组返回的只读快照结果，不改变持久化 version 1 格式
- [x] 1.2 在 `agent-memory-store.ts` 实现遵守 enabled、scope 和 project 覆盖 global 规则的聚合读取，并在任一 catalog 文件失败时返回整体失败
- [x] 1.3 增加存储测试，覆盖 disabled catalog/item、同名 scope 覆盖、跨项目隔离和单文件损坏导致整体失败

## 2. Prompt 展开与折叠决策

- [x] 2.1 在 `memory-prompt.ts` 实现不暴露内部元数据的展开格式，并保留现有 catalog 折叠格式和 memory 优先级说明
- [x] 2.2 实现基于完整展开文本 token 的纯模式选择，使用 `min(floor(contextWindow * 0.02), 8_000)` 预算并返回可复用的投影结果
- [x] 2.3 增加 prompt 单元测试，覆盖无 memory、小型全量展开、比例边界、绝对上限、全局二态选择和元数据隐藏

## 3. Agent loop 与 context usage 接入

- [x] 3.1 通过 memory prompt resolver 在每次真实 provider continuation 前重读有效 catalogs/items，并在聚合读取失败时整轮回退到完整 catalog 索引
- [x] 3.2 让 provider records 与 context usage 复用同一份 agent memory 投影文本，并在 debug 摘要中仅记录模式、数量和 token 等非敏感信息
- [x] 3.3 更新 `read_memory` 工具描述，区分“使用已展开事实”和“为精确 mutation 获取 item id”，不改变公开参数及结果协议
- [x] 3.4 更新 runtime 与 context usage 测试，覆盖每轮重读、展开/折叠切换、读取失败回退、实际 Memory 分类和 tool continuation 行为

## 4. 验证

- [x] 4.1 运行 `npm run typecheck` 并修复类型错误
- [x] 4.2 运行 `npm test` 并确保完整测试通过
- [x] 4.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 并确保 JavaScript 语法检查通过

## 5. Memory prompt 职责收敛

- [x] 5.1 将 memory 读取、失败回退、格式化、展开/折叠选择和 token 汇总集中到 `memory-prompt.ts`
- [x] 5.2 简化 `system-prompt.ts` 与 `agent-loop-runtime.ts`，并将 prompt 单元测试迁移到新模块
