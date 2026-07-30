## Why

Agent memory 属于低频能力，但当前四个专属 memory tool 的定义会在每次 provider 请求及 continuation 中常驻占用上下文。将 memory 操作改为按需加载的内置 skill，可以减少普通请求的工具 schema 开销，同时继续保留持久化记忆和 `/memory` 人工管理能力。

## What Changes

- **BREAKING** 从默认工具集合移除 `read_memory`、`add_memory`、`update_memory` 和 `remove_memory`，并删除它们的 handler、专属审批和终端投影。
- 新增随 npm 包发布的内置 `agent-memory` skill；provider 常驻上下文只包含其短 catalog 描述，完整操作说明和资源清单通过 `use_skill` 按需加载。
- 为该 skill 提供固定的 Node.js 脚本和参考文档，由脚本复用现有 agent memory store，完成读取、新增、更新、删除和校验，禁止模型直接修改内部 JSON 文件。
- Skill 脚本通过现有 `run_bash_command` 执行，不增加 memory 专属审批分类；普通 TUI 和默认 `--once` 可直接执行脚本，plan mode 继续遵守现有 bash allowlist。
- 保留 agent/user memory 存储、每轮 prompt 注入、global/project scope、enabled 状态和 `/memory` 的完整人工管理能力；agent memory skill 不操作 user memory，也不修改 enabled 状态。
- 更新 memory prompt、context usage、headless 策略说明和文档测试，移除所有对旧 memory tools 的运行时预期。

## Capabilities

### New Capabilities

<!-- 无新增独立 capability；内置 memory skill 纳入现有 skill-system。 -->

### Modified Capabilities

- `agent-memory`: 将 agent 的读取和 mutation 接口从四个专属 tools 改为按需加载的内置 skill 脚本，同时保留 store、prompt 注入和 `/memory` 管理。
- `skill-system`: 增加随应用发布、低优先级发现且带固定资源脚本的内置 skill 来源。
- `tool-approval`: 移除 memory tool mutation 的专属审批要求，memory skill 脚本仅遵守普通 bash 风险策略。
- `tool-message-rendering`: 移除 memory tools 的专属 Remembering/Recalling/Revising/Forgetting 投影。
- `context-usage-command`: 移除 `read_memory` tool result 的分类特例，并让内置 memory skill 遵守现有 Skills/Tools 分类规则。
- `single-turn-cli-chat`: 移除 headless/full-access 对 memory mutation tool 的特例，明确不命中通用高风险规则的 memory skill 脚本可在默认单轮模式执行。

## Impact

- 影响默认 tool registry、风险分类器、tool renderer、provider 工具定义和相关测试。
- 影响 skill discovery、构建资源复制和 npm 发布产物；内置 skill、参考文档及普通 CommonJS 脚本必须随 `dist/src` 发布。
- 继续复用 `src/memory/agent-memory-store.ts`、memory prompt 和 `/memory` command port，不迁移现有 `~/.echo/agent-memory/` 数据格式。
- 旧 transcript 中的 memory tool records 不再获得专属投影，可按通用 tool record 安全显示。
