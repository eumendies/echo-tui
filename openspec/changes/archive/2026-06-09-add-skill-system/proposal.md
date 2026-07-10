## Why

当前 echo_tui 已具备本地工具、slash command、上下文压缩和 provider-neutral agent loop，但缺少可复用的任务级指导能力。用户希望引入类似 Claude/Windsurf 的 skill 机制，让模型能按需加载特定工作流说明，而不是把所有长指令常驻塞进 prompt。

## What Changes

- 新增文件系统级 skill 发现能力，支持从项目级和用户级目录读取 `SKILL.md`。
- 在 system prompt 中常驻注入简短 skill catalog，仅包含名称和描述，供模型判断何时调用 skill。
- 新增 `use_skill` 本地工具，模型可按名称加载完整 skill 内容；返回内容作为普通 tool result 进入 transcript，并随现有 compaction 机制自然淡出上下文。
- 记录 `use_skill` 工具调用，使系统可以从 transcript 中识别 skill 使用历史。
- 第一版不新增 `/skill` slash command；带参数 slash 调用后续单独 change 设计。
- 复用现有 tool execution、transcript 和 compaction 语义，不引入独立 active skill 生命周期或手动逐出机制。

## Capabilities

### New Capabilities
- `skill-system`: 定义 skill 文件发现、catalog 注入、`use_skill` 工具和使用记录的外部行为。

### Modified Capabilities
- `local-tool-execution`: 默认本地工具 registry 新增 `use_skill` 工具，并规定其结果作为普通 tool result 参与后续 agent continuation。
- `streaming-llm-service-adapter`: provider 请求的 system prompt 需要包含短 skill catalog，使模型知道可按需调用 `use_skill`。
- `context-compression`: skill 工具结果不走特殊生命周期，随普通 transcript 记录一起参与压缩与摘要。

## Impact

- 影响 `src/agent/` 中 provider records 构建和默认 tool registry 创建路径。
- 影响 `src/tools/` 或等价本地工具目录，新增 `use_skill` handler 和 skill registry 读取逻辑。
- 影响 transcript 记录扫描或辅助函数，用于识别已有 `use_skill` tool call 使用记录。
- 新增或更新测试覆盖 skill discovery、tool execution、catalog 注入、使用记录和 compaction 兼容行为。
