## Why

当前 `echo-tui` 依赖用户手写 `~/.echo/config.json` 配置 provider 和模型，首次使用门槛较高，也容易暴露 `agentType`、`baseURL` 等实现细节。现在已经具备 OpenAI Responses、OpenAI Chat Compatible 和 Anthropic Compatible 三类真实 provider，适合提供一个内置配置面板，把协议选择、API key 和模型列表配置收敛到可交互流程中。

## What Changes

- 新增主 UI 内 `/config` slash command，打开 provider/model 配置面板；该流程不写 transcript、不触发 agent、不进入工具流。
- 新增 provider preset catalog：提供 OpenAI Responses API、OpenAI Chat Compatible API、Anthropic Compatible API 和 Xiaomi Mimo Token Plan 等用户可选类型；预定义 provider 由后台 preset 决定 `agentType`、固定 `baseURL` 和默认 headers。
- 配置面板不向用户展示 `agentType`；用户选择的是 provider 类型或预定义 provider，后台负责解析为运行时 provider 配置。
- 配置面板支持 provider 列表、provider 详情编辑、API key masked 输入、按 preset 展示/隐藏/固定 Base URL、模型增删改和默认模型选择。
- 保存时写入当前项目支持的新 `llm.providers` / `llm.models` / `llm.selectedModel` 结构，并保留配置文件中与本面板无关的其他配置节点。
- **BREAKING**: 不兼容旧的顶层或 model profile 级 `agentType`、`apiKey`、`baseURL`、`headers` 配置格式；配置命令只读取和写入 provider-backed 配置结构。

## Capabilities

### New Capabilities
- `interactive-llm-config-command`: 定义 `/config` slash command、交互式 provider/model 配置面板、preset catalog、保存与取消行为。

### Modified Capabilities
- `installable-cli`: 保持可安装 CLI 只有默认启动、help 和 version 普通入口；`config` 与 `init` 一样按 unknown command 处理。
- `streaming-llm-service-adapter`: 扩展 LLM 配置读取，支持 provider preset 解析，并移除旧配置格式兼容要求。
- `typescript-build-test-pipeline`: 将新增 `/config` handler、config editor 和 footer config surface 模块纳入 TypeScript 编译和测试路径。

## Impact

- 代码：`src/commands/config-command-handler.ts`、`src/app/command-host.ts`、`src/render/footer/command-surfaces.ts`、`src/render/footer/config-surface.ts`、`src/config/llm-config.ts`、新增 provider preset/config editor 相关模块，以及对应测试；删除独立 CLI config 子命令。
- 用户配置：继续使用 `~/.echo/config.json`，但配置面板只管理 `llm.providers`、`llm.models` 和 `llm.selectedModel`；保存时应保留 `tools`、render 等其他配置。
- 交互：新增主 UI 内嵌配置界面，复用 command surface，不切换 alternate screen，不引入第三方 TUI 库。
- 文档：更新使用说明，展示 `/config` 配置流程和 preset provider 扩展语义。
