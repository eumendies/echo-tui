# Change: 简化内置上下文并支持 SYSTEM.md 覆盖

## Why

当前内置上下文重复描述了各工具 definition 已提供的选择建议，并包含可由模型后训练与运行时边界承担的通用安全提醒。这些常驻规则增加上下文占用，也不允许用户在不修改源码的情况下替换 Echo TUI 的基础 system prompt。

## What Changes

- 将语言跟随、简洁、直接、可行动和终端友好合并为一条回答风格规则。
- 保留基于当前对话与工具结果、明确表达不确定性且不编造事实的证据规则。
- 将多步骤进度汇报和 todo 生命周期合并为一条，仅用于非平凡多步骤任务。
- 移除内置 prompt 中的工具必要性判断、具体工具选择偏好和通用敏感信息提醒。
- 支持用户级 `~/.echo/SYSTEM.md` 与项目级 `SYSTEM.md` 替换内置基础 prompt，项目级文件优先。
- `SYSTEM.md` 只覆盖基础 prompt；cwd、AGENTS.md、skills、memory 和运行时上下文继续由 Echo TUI 注入。
- 不改变工具 definitions、风险分类、审批、plan mode、AGENTS.md、skills 或 memory 的加载行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `streaming-llm-service-adapter`: 精简每次真实请求注入的默认基础 system prompt，并允许通过用户级或项目级 `SYSTEM.md` 替换该基础文本。

## Impact

- 修改 system prompt 组合与 agent loop 初始化逻辑。
- 新增 `SYSTEM.md` 本地文件发现和读取逻辑。
- 更新相关 system prompt 单元测试、运行时集成测试、架构文档和主规格；不改变 provider payload 结构、工具 API 或 JSON 配置格式。
