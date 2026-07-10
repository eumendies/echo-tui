## Why

当前真实 agent 只注入源码内置 system prompt、当前工作目录和 skill catalog，无法自动读取用户级或项目级 `AGENTS.md` 中的长期协作约定。用户需要在每次会话中重复说明项目规范，且从项目子目录启动时缺少稳定的项目指令加载规则。

## What Changes

- 在 provider system prompt 中追加全局与项目内 `AGENTS.md` 指令，作为 transient runtime context 注入，不写入 transcript 或 session 持久化。
- 读取固定全局路径 `~/.echo/AGENTS.md`。
- 使用 `.git` 与 `.echo` 作为项目根标记，从当前 `cwd` 向上寻找最近项目根；找到后读取项目根到 `cwd` 路径链路上的 `AGENTS.md`。
- 未找到项目根时只读取当前 `cwd/AGENTS.md`，不继续向上猜测，避免误读无关父目录指令。
- 明确指令优先级：内置运行时约束和当前交互模式优先于 AGENTS 指令；更具体路径的项目 AGENTS 优先于项目根 AGENTS；项目 AGENTS 优先于全局 AGENTS。
- 不引入新的 provider API、第三方依赖或可覆盖内置 system prompt 的用户配置字段。

## Capabilities

### New Capabilities

### Modified Capabilities
- `streaming-llm-service-adapter`: provider system prompt 需要加载并注入全局/项目 `AGENTS.md` 指令，并定义项目根判定、读取顺序、优先级和持久化边界。

## Impact

- `src/agent/system-prompt.ts`: 格式化 AGENTS 指令 section，并保持内置 prompt、plan mode、skill catalog 的边界。
- `src/agent/agent-loop-runtime.ts`: 在每次 agent run 构造 provider records 前加载 AGENTS 指令，并传入 system prompt context。
- `src/types/agent.ts`: 如需测试 seam，可扩展 runtime dependencies 以注入 AGENTS loader。
- 新增 `src/agent/agent-instructions.ts` 或等价模块，用于发现项目根、读取 AGENTS 文件、限制大小和格式化来源元数据。
- `test/agent/agent-loop-runtime.test.js` 与 system prompt 相关测试需要覆盖全局/项目 AGENTS、项目根判定、缺失文件、plan mode 和 transcript 非持久化语义。
