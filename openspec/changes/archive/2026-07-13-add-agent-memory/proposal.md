## Why

当前 user memory 会把全部启用内容注入每次 provider request，适合用户显式偏好，但不适合持续增长、由 agent 自主整理的项目经验。需要一套与 user memory 分离、按 catalog 索引发现并按需读取内容的 agent memory，使 agent 能跨会话保留经验，同时避免每轮加载全部条目。

## What Changes

- 新增独立的 agent memory 存储，以 catalog 索引和 catalog item 文件组织持久内容，并保留 global/project scope 约束。
- 每次真实 provider request 自动注入当前 scope 可用的 catalog 名称和描述，不注入 scope、item 或其他内部元数据。
- 新增 `read_memory`、`add_memory`、`update_memory` 和 `remove_memory` 工具；读取结果使用普通 tool result，写工具复用现有工具审批流程。
- `add_memory` 在目标 agent catalog 不存在时自动创建 catalog 并添加首个 item；删除最后一个 item 时自动删除空 catalog。
- memory mutation 工具通过 `type` 区分 user memory 与 agent memory，使 agent 在用户要求“记住”时也能受控修改 user memory。
- 扩展 `/memory`，使用户可以浏览、创建、编辑和删除 user memory 以及不同 scope 下的 agent catalog/item。
- 将 agent memory catalog 索引的 prompt token 计入现有 Memory context usage 分类。

## Capabilities

### New Capabilities
- `agent-memory`: 定义 agent memory 的分层存储、scope 过滤、catalog 索引注入、按需读取和 mutation 工具语义。

### Modified Capabilities
- `user-memory`: 允许经审批的 memory 工具修改 user memory，并扩展 `/memory` 以区分和管理 user/agent memory。
- `command-host-runtime`: 扩展 memory facade，使 `/memory` handler 能受控管理 agent catalog 和 item，而不直接访问文件系统。
- `tool-approval`: 将 `add_memory`、`update_memory` 和 `remove_memory` 纳入现有非 bash 工具审批与会话级授权流程。
- `context-usage-command`: 将 transient agent memory catalog 索引的 token 归入 Memory 分类。

## Impact

- 新增 agent memory 类型、存储模块和四个内置 memory tool handler，并接入默认 tool registry、风险分类和工具结果渲染。
- 修改 agent loop/system prompt，使每次真实 provider request 读取当前 cwd 对应的 catalog 索引。
- 扩展 `/memory` command state、CommandHost memory facade 和 footer surface，支持 user/agent 类型及 catalog/item 层级。
- 扩展 context usage 估算与测试；新增存储一致性、scope 隔离、工具审批、tool continuation 和交互管理测试。
- 不引入第三方依赖，不改变现有 `~/.echo/memories.json` 格式或 user memory 默认注入行为。
