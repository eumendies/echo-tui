## Why

当前 footer render state 在 spinner 与 streaming 高频重绘期间会通过模型命令信息读取链路反复同步读取并解析 `~/.echo/config.json`，导致响应期间产生无意义的同步 I/O 并阻塞事件循环。模型名称和 reasoning effort 属于当前进程内 UI 状态，通常只在 `/model`、`/effort` 或 `/config` 保存后变化，适合由 `ModelContext` 缓存并驱动 status line。

## What Changes

- `ModelContext` 持有当前模型展示所需的进程内状态缓存，包括可选模型列表、当前 selected model、模型 label 和 reasoning effort。
- 普通 footer/status line 渲染从 `ModelContext` 缓存读取模型展示状态，不在每次 redraw 中读取或解析用户配置文件。
- `/model`、`/effort` 和 `/config` 等应用内写入配置成功后同步刷新 `ModelContext` 缓存，使 status line 在下一次重绘展示新模型或新 effort。
- `/model`、`/effort` 打开命令 surface 时仍可读取配置文件以构建命令列表和错误信息；该读取不发生在高频 redraw 路径。
- 不支持外部编辑 `~/.echo/config.json` 后实时刷新 status line；外部编辑仍由后续 agent run 的既有配置读取语义处理。
- 不引入 breaking change。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `app-context-state-container`: 明确 `ModelContext` 负责维护模型状态缓存，footer render state 派生不得在高频 redraw 路径读取用户配置文件。
- `terminal-tui-prototype`: 明确 status line 在应用内模型配置写入后从缓存状态更新模型与 effort 展示，同时不承诺响应外部配置文件编辑。

## Impact

- 影响 `src/app/state/model-context.ts`、`src/app/state/app-context.ts`、`src/app/command/command-host.ts` 以及与 `/model`、`/effort`、`/config` 保存相关的测试。
- 不改变 `readLlmConfig()` 的 agent 每轮读取语义；后续普通模型请求仍从用户配置文件解析最新运行时配置。
- 不新增依赖，不引入 watcher、异步渲染或全局配置单例。
