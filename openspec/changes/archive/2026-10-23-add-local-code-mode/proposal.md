## Why

本地工具目前依赖模型逐轮接收结果、判断和构造后续调用，跨文件筛选、分支和聚合会让大量中间内容进入模型上下文。增加可选的 JavaScript 编排入口，让模型在明确的数据契约下组合现有本地工具；保留原生工具路径，避免要求未经专项 Code Mode 训练的模型全面切换执行方式。

## What Changes

- 新增默认关闭的 `tools.codeMode.enabled` 配置，并在 `/config` →“常规”提供 Code Mode 开关，复用草稿、显式保存和未保存保护；保存后下一次运行生效。启用时额外暴露 provider-neutral 的 `run_code` 工具，不新增 interaction mode，不替换原生工具。
- 一期仅支持主对话和 `--once` 中的 `glob`、`grep`、UTF-8 文本 `read_files`；脚本使用普通 JavaScript、`await`、循环、分支和有界并发。MCP、Bash、编辑、网络工具、子 Agent、用户问题和递归执行均不进入脚本白名单。
- 为这三个工具建立版本化、机器可读的输入输出契约；脚本消费真实采集的数据，不解析带行号、ANSI 或截断提示的展示文本，不复用仅供 UI 的 display metadata 作为公共契约。
- 新增隔离、单次、无状态的脚本运行环境和策略感知桥接；不暴露 Node.js 能力、宿主对象、环境变量或直接网络访问，限制计算、内存、调用、并发和结果大小。
- 内部调用继承当前运行的工具准入、plan/readonly/headless 策略和取消信号；外层脚本执行不得扩张内部权限，`--full-access` 不解除脚本隔离或白名单。
- 为内部调用提供有界的本地运行记录、TUI 摘要和生命周期观测；模型只接收外层脚本的有界结果、日志与诊断，不重复接收所有中间结果。
- 增加原生工具与可选 Code Mode 的配对评估，分别记录首次成功率、最终成功率、token、耗时和副作用，不预设 Code Mode 对所有模型更优。

## Capabilities

### New Capabilities

- `local-code-mode`: 可选入口、隔离运行时、受控本地工具桥接、权限继承、资源限制、取消、审计和模型适用性验证。
- `local-tool-script-contracts`: `glob`、`grep` 与文本 `read_files` 的脚本数据契约、输入校验、错误、分页、截断及与原生展示通道的兼容性。

### Modified Capabilities

- `config-surface-settings`: 在现有“常规”Tab 增加 Code Mode 开关、默认值、草稿/保存、字段保留与下一轮生效要求，不新增独立 Tab 或页面。

现有原生工具的参数、展示、审批及执行模式保持不变；新增入口、数据通道和本地运行记录的增量要求由以上两个新能力定义。

## Impact

- 工具及协议：`src/tools/`、`src/types/tool.ts`，新增脚本结果通道和 Code Mode 模块，复用本地工具的参数归一化及数据采集。
- 运行编排：`src/agent/agent-setup.ts`、`src/agent/loop-runtime/`，接入工具目录、策略检查、取消与观测；各 provider 继续使用普通 function tool 协议。
- 配置及说明：`src/config/llm-config.ts`、常规设置草稿与保存、运行级配置 snapshot、临时系统上下文、`/config` handler/renderer 和使用文档。一期支持 `/config` →“常规”及直接编辑配置文件开启，不新增 slash command、CLI flag 或独立设置页面。
- 本地事实与展示：`src/types/transcript.ts`、`src/persistence/`、provider transcript converter、`src/observation/`、`src/render/`；持久化的内部记录不得进入模型请求或上下文压缩输入。Headless 继续不创建 transcript session。
- 依赖：拟采用 QuickJS/WASM 在独立子进程中运行，实施前验证 Node >= 20.3、CommonJS、WASM 打包及跨平台可用性；不得以 `node:vm`、普通 Node 子进程或现有 Bash 沙箱降级冒充隔离执行。
- 测试：本地工具契约、运行时逃逸/限额、策略矩阵、provider 消息配对、TUI/持久化、headless 回归及独立模型评估。无现有用户配置或会话数据的强制迁移，无破坏性 API 变更。
