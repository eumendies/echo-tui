## Context

当前 `renderFooter()` 会在 spinner 约 10 FPS、streaming 约 20 FPS 的路径上反复调用 `AppContext.createRenderState()`。该路径为了生成 status line 的模型 segment，会进入 `ModelContext.createModelCommandInfo()` 并触发 `readLlmModelConfigInfo()`，最终同步读取并解析 `~/.echo/config.json`。

模型 label 和 reasoning effort 是 footer 展示状态，响应期间通常不会变化。真正会改变它们的应用内事件主要是 `/model` 选择、`/effort` 修改和 `/config` 保存。相比每帧读取文件，使用 `ModelContext` 的实例级缓存更符合 AppContext 子 context 的状态边界，也避免把配置 I/O 放进渲染热路径。

## Goals / Non-Goals

**Goals:**

- 让普通 footer/status line 渲染从 `ModelContext` 内存缓存读取模型 label 和 reasoning effort。
- 消除 spinner、streaming 高频 redraw 路径上的 `~/.echo/config.json` 同步读取和 JSON 解析。
- 在 `/model`、`/effort`、`/config` 等应用内写入配置成功后刷新 `ModelContext` 缓存。
- 保持 agent run 每轮通过 `readLlmConfig()` 读取最新运行时配置的既有语义。
- 保持每个 `createApp()` 实例的模型展示缓存相互隔离。

**Non-Goals:**

- 不支持外部编辑 `~/.echo/config.json` 后实时刷新当前 status line。
- 不引入 `fs.watch`、mtime polling、TTL polling 或全局配置服务。
- 不缓存包含 API key、headers 等敏感字段的完整 `LlmConfig`。
- 不改变 `/model`、`/effort`、`/config` 的用户可见交互流程。

## Decisions

### Decision 1: 缓存在 `ModelContext` 内，而不是 `llm-config.ts` 全局层

`ModelContext` 是 AppContext 的实例级子 context，已经承担 `/model` 与 `/effort` 命令所需的模型信息读取、脱敏和写入职责。把缓存放在这里可以保证每个 `createApp()` 实例独立，并且只缓存 UI 展示所需的非敏感模型信息。

替代方案是给 `readLlmModelConfigInfo()` 或 `readLlmConfig()` 增加模块级缓存。该方案会让测试注入和多 app 实例隔离更复杂，也可能误伤 agent 每轮读取最新配置的语义，因此不采用。

### Decision 2: footer render 只读缓存，不触发配置刷新

普通 footer/status line 渲染应只读取 `ModelContext` 中已经存在的模型状态缓存。缓存可以包含最近一次成功解析出的模型列表、selected index 和 status line 展示状态，也可以包含安全错误摘要；但 render 本身不得为了补齐状态去同步读取用户配置。

替代方案是在 render 中使用 mtime 或 TTL 检查。该方案仍会在高频 redraw 路径产生同步 syscall 或时间相关行为，且本次明确不支持外部编辑实时刷新，因此不采用。

### Decision 3: 应用内写入成功后显式刷新缓存

`/model`、`/effort` 和 `/config` 是当前应用内会修改模型展示状态的入口。写入成功后由对应 app/command 边界调用 `ModelContext` 的刷新能力，使下一次 status line 显示新模型或新 effort。写入失败时不应更新缓存，避免 UI 展示未持久化状态。

替代方案是在命令 handler 返回前直接手工拼接新的 status line 状态。该方案容易与配置解析规则重复，并可能遗漏 selected model fallback、provider-backed profile 解析或 reasoning effort 过滤逻辑，因此不采用。

### Decision 4: 命令打开可继续读取配置文件

`/model` 和 `/effort` 打开 command surface 时需要展示完整列表、selected index 和安全错误信息。该读取发生在用户显式命令事件上，不属于高频 redraw 路径，可以继续使用现有配置解析逻辑，并在读取成功后同步更新缓存。

## Risks / Trade-offs

- **外部编辑后 status line 不实时更新** → 本次明确作为非目标；后续 agent run 仍按既有逻辑重新读取配置文件，若未来需要实时 UI 刷新可另开 change 设计 watcher 或 idle refresh。
- **模型状态刷新入口遗漏导致 UI 显示旧值** → 在任务中覆盖 `/model`、`/effort`、`/config` 保存成功路径，并增加测试验证写入后 status line 更新。
- **缓存完整配置可能扩大敏感信息驻留面** → 只缓存模型 id、model name、provider id 和 reasoning effort 等 UI 必需字段，不缓存 API key、headers 或完整 provider runtime config。
- **初始化时配置损坏导致 status line 状态不明确** → 缓存应能表达安全错误或 unavailable 状态，footer 展示保持稳定占位，不在 redraw 中抛出配置异常。

## Migration Plan

该变更只影响运行时内存状态和渲染派生路径，不需要用户配置迁移。若回滚，恢复 render path 直接读取模型命令信息即可，但会重新引入高频同步配置读取。

## Open Questions

无。外部编辑实时刷新已明确排除在本次范围之外。
