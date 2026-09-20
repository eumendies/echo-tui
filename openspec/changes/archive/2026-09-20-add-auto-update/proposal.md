## Why

echo-tui 已经通过 npm registry 分发（`@eumendies/echo-tui`），但运行中的副本不会感知新版本：用户只能凭印象手动检查或重装，长期停留在旧版本。需要让 TUI 在启动路径上主动、克制地发现新版本，并让用户一键完成"更新 + 重启新版本"，同时不打扰正在使用旧版本的日常开发（源码运行）与离线场景。

## What Changes

- 新增启动更新检查：TUI 首帧渲染后异步请求 npm registry 的 `latest` 版本并与当前版本比较版本号。只对包管理器安装的副本生效（源码运行与 npx 缓存跳过），可由配置关闭；网络失败静默降级，成功检查按 24h TTL 缓存，避免每次启动都联网。
- 新增更新提示 choice surface：发现新版本且用户处于空闲状态时弹出"更新可用"卡片，选项为 `立即更新` / `稍后提醒` / `忽略此版本`（Esc 等同稍后提醒）。提示不打断正在进行的输入、assistant turn、其它 modal 与 command session；输入优先级排在所有既有 modal 之后。
- 新增前台自更新流程：选择 `立即更新` 后恢复终端并退出 raw mode，前台执行 `npm install -g @eumendies/echo-tui@latest`（npm 输出直通终端），成功后自动重启新版本；安装失败或重启失败时给出可读错误并以当前版本重启，避免把用户甩回 shell；重启前写入短窗口防重弹标记，避免重启进程立即重复提示。
- 新增更新状态文件 `~/.echo/update-state.json`：记录最近成功检查时间、最新版本与"忽略此版本"；忽略只针对该版本，出现更高版本时恢复提示；"稍后提醒"只作用于本次会话。
- `/config` 常规 Tab 新增「启动时检查更新」开关，写入 `updates.checkOnStartup`（默认开）。
- `installable-cli` 规格修正：移除"暂不发布 npm registry"的过时边界，改为"通过 npm registry 分发，安装副本参与启动更新检测"。

## Capabilities

### New Capabilities

- `startup-auto-update`: 启动更新检查的时机、跳过条件、registry 请求、状态文件与缓存、静默失败；更新提示 choice surface 的文案、选项、呈现门控与输入优先级；前台自更新与自动重启流程；稍后提醒与忽略版本的持久化语义。

### Modified Capabilities

- `config-surface-settings`: "常规设置草稿与持久化"需求新增「启动时检查更新」开关（`updates.checkOnStartup`，默认 true，开/关展示，随常规设置一同校验、保存与归一化）。
- `installable-cli`: 以"通过 npm registry 分发"替换"暂不发布 npm registry"决定；安装副本在启动时参与有节制的更新检测。

## Impact

- 代码：新增 `src/update/`（版本比较、registry 检查、状态文件读写、前台更新与重启）；新增 `src/app/auto-update-controller.ts`，承载检查结果、呈现等待、提示状态机与决策路由；`src/app/main.ts` 只装配检查/更新/持久化端口、空闲门控闭包与 activity tick 接入；`src/app/input-event-controller.ts` 增加最低优先级 modal 端口并记录最近输入时间；`src/config/app-settings-config.ts`、`src/commands/config/{state,handler}.ts`、`src/render/footer/config-surface.ts` 增加开关行与字段。
- 配置：`~/.echo/config.json` 新增 `updates.checkOnStartup`（默认 true）；新增状态文件 `~/.echo/update-state.json`（含检查缓存、忽略版本与重启防重弹标记）。
- 依赖：无新增 npm 依赖（使用 Node 20 内置 fetch 与手写版本号比较）。
- 测试：新增 `test/update/`（版本比较、检查缓存、忽略语义、失败静默、更新与重启流程）；`test/app/auto-update-controller.test.js`；增补 `test/app/input-event-controller.test.js`、`test/app/main.test.js` 与配置面板相关测试。
- 文档：`README.md` 与 `docs/tui-architecture.md` 同步配置字段与行为说明。
