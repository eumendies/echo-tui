## Why

当前 `echo_tui` 的 assistant 仍由 fake agent 逐字回显用户输入，无法验证真实大模型服务的流式交互、配置加载、网络错误处理和最终 transcript 提交流程。现在应把首版能力推进到真实流式对话，同时继续保持现有 TUI、slash command 和 transcript persistence 的稳定契约。

## What Changes

- 新增真实 LLM agent adapter，使普通用户消息可以获得真实 assistant 回复。
- 直接新增并使用 OpenAI 官方 SDK，避免先做一层临时 fetch 客户端后再迁移。
- 首版只支持文本对话输出的流式展示：进入 thinking、接收文本增量、更新 pending preview、完成后提交 assistant transcript。
- 新增 `~/.echo/config.json` 作为运行时配置来源，用于提供模型服务连接配置、模型名和输出限制等必要参数；不得把真实凭据写入源码、OpenSpec artifacts、测试 fixture 或文档示例。
- 保留 fake agent 作为测试注入或显式开发 fallback，但 CLI 默认行为应切换为真实 adapter，除非缺少必要配置时明确失败并提示配置方式。
- 不实现工具调用、函数调用、多模态输入、模型选择联动、重试队列或后台任务调度。

## Capabilities

### New Capabilities
- `streaming-llm-service-adapter`: 定义基于 OpenAI 官方 SDK 的真实流式 LLM adapter 配置、请求生命周期、流式增量、完成提交和错误处理行为。

### Modified Capabilities
- `terminal-tui-prototype`: 将普通 assistant 响应从 mock 回显扩展为真实流式 assistant 生命周期，并保持现有 footer pending、append-only transcript、slash command、`/clear`、`/resume` 和持久化行为兼容。

## Impact

- 受影响代码：`src/agent/` 下新增真实 adapter/runtime，`src/app/main.js` 的默认 agent wiring，CLI 启动配置读取，相关测试与文档。
- 受影响行为：普通非 slash 输入会调用真实模型服务并流式展示模型输出；缺少配置或网络/服务出错时需要给出明确的本地错误反馈，不应静默成功。
- 依赖影响：新增 OpenAI 官方 SDK；实现时必须兼容当前 CommonJS 和 Node.js >= 20 约束。
- 配置影响：新增用户级配置文件 `~/.echo/config.json`；该文件不属于项目仓库，不应被测试或文档示例写入真实凭据。
