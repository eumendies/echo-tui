## Context

echo-tui 通过公共 npm registry 分发（`main` 分支与 npm `latest` 已对齐，源码 `dev` 分支版本号可能落后）。当前没有任何更新感知：用户不会知道有新版本，只能凭印象手动 `npm view` 或重装。

既有可复用接缝：

- `src/app/main.ts` 的 `start()` 在首帧渲染后已有"MCP bootstrap 异步任务"模式，可承载不阻塞启动的更新检查；
- `choice` surface（tool approval、`ask_user_questions` 共用）支持标题、正文、选项描述与键位提示，渲染层无需新增；
- `InputEventController` 的 modal 优先级链（用户问题 > 工具审批 > 文件选择）可插入最低优先级的一档，modal 消费全部输入是既有纪律；
- `~/.echo/` 已有用户级配置与状态文件先例；`readPackageVersion()` 提供当前版本号；Node 20 内置 `fetch`，不必新增依赖。

约束：仓库要求不引入第三方 TUI 库、保持 ANSI + raw mode 机制、`--once` headless 路径与 TUI 生命周期分离、footer surface 为可重渲染的瞬时状态；文案规范要求内置用户可见文案以中文为主。

## Goals / Non-Goals

**Goals:**

- 启动路径上主动发现 npm registry 上的新版本，只对包管理器安装的副本生效，源码开发与 npx 运行不受打扰。
- 发现新版本后在用户空闲时弹出可选择的提示（立即更新 / 稍后提醒 / 忽略此版本），不打断输入、回合与其它 modal。
- "立即更新"提供前台、可见、可解释的自更新体验：恢复终端 → 前台执行 `npm install -g` → 自动重启新版本；失败可读并以当前版本重启。
- 检查请求有超时与 24h 缓存、失败静默；用户可通过 `/config` 开关完全关闭，且不引入环境变量开关。

**Non-Goals:**

- 不做后台静默更新、不驻留更新进程、不做增量下载或包管理器探测。
- 不做 changelog / release notes 展示，不新增 `/update` 手动检查命令。
- 不检查 beta/next 等非 `latest` 通道，不改动 `--once` headless 行为。
- 不写 transcript、不进入 provider 上下文、不新增 observation 事件。

## Decisions

### D1: 检查时机与接线位置

更新检查在 TUI 组合根（`run()` 创建的 app 实例）中、首帧 `renderInitial` 之后以 fire-and-forget 方式启动，与 MCP bootstrap 并行；检查结果只影响瞬时 footer surface 与会话内门控，不写 transcript、不进入 provider 请求。`--once` 不创建 `createApp`，自然不检查。

备选（被否）：在 `src/cli/main.ts` 启动 TUI 前同步检查——会延迟首帧；在 banner 里打印一行提示——无法承载"选择更新"交互。

### D2: 资格判定与开关优先级

资格判定顺序（前者优先）：

1. `updates.checkOnStartup`（`~/.echo/config.json`，默认 `true`）为假 → 跳过；
2. 运行副本判定：包根目录（由模块 `__dirname` 向上三级推导，与 `readPackageVersion` 同口径）不含 `node_modules`（源码运行 / `npm link`）或含 `_npx`（npx 缓存）→ 跳过；含 `node_modules` → 检查。

此外，处于更新重启窗口（状态文件中的 `restartGuardAt`，见 D4/D7）时直接跳过，不再重新提示。

资格判定是路径启发式：npm/pnpm/bun/yarn 全局安装副本都会命中"含 node_modules"，v1 不做包管理器探测（见 Risks）。源码运行默认跳过，避免 `dev` 分支版本号落后于 npm `latest` 时每次开发启动都被提示；开发期验证提示 UI 时改用临时 prefix 安装本地构建（见 tasks 8.5），不为纯开发入口保留常驻行为分支。

### D3: registry 请求与版本比较

- 请求 `<registry>/@eumendies%2Fecho-tui/latest`，registry 取 `process.env.npm_config_registry`，缺省 `https://registry.npmjs.org`；请求带 5s 超时（`AbortSignal.timeout`）与 `echo-tui/<version>` User-Agent；只接受响应中合法的 `version` 字符串。
- 网络错误、超时、非 2xx、解析失败一律静默返回"无结论"，不提示、不写缓存时间。
- 版本比较只按三段数字进行（项目只发布纯数字 `x.y.z` 版本，不做 prerelease 排序），不新增 `semver` 依赖；比较结果为 `latest > current` 且 `latest !== ignoredVersion` 时进入可提示状态。

### D4: 更新状态文件与缓存

`~/.echo/update-state.json` 字段：`lastCheckedAt`（最近一次成功检查的毫秒时间戳）、`latestVersion`（最近一次成功检查看到的 latest）、`ignoredVersion`（用户选择忽略的版本）、`restartGuardAt`（最近一次更新重启的毫秒时间戳；短窗口内跳过重新提示）。

- 成功检查才写入并刷新 `lastCheckedAt`；失败不写（下次启动重试）。
- 距 `lastCheckedAt` 未满 24h 时直接使用缓存 `latestVersion`，不再联网；因此"发现新版本但选择稍后"的后续启动无需网络即可继续提示。
- 写入使用同目录临时文件 + rename 原子替换；读取容错，损坏时按"无状态"处理。
- 该文件独立于 `~/.echo/config.json`，不触发用户配置 watcher 与 `UserConfigContext` 的变更域通知。

### D5: 提示交互形态

新增 app 层 `AutoUpdateController`（`src/app/auto-update-controller.ts`），承载检查结果、呈现等待、提示状态机与决策路由，并投影为 `choice` surface：

- 标题「更新可用」；正文说明 `发现新版本 v<latest>（当前 v<current>）`；选项描述说明"运行 npm install -g 并自动重启"等行为；
- 选项（中文，按调用顺序渲染）：`立即更新` / `稍后提醒` / `忽略此版本`，各自带一行描述；
- 键位：↑/↓ 移动、Enter 确认、Esc 等同「稍后提醒」；dismiss hint 说明三者；
- 默认键盘焦点放在「稍后提醒」：提示是自动弹出的，避免用户习惯性 Enter 直接触发退出与全局安装；想更新只需一次 ↑/↓ + Enter。

controller 只持有瞬时状态；检查、更新、忽略持久化、终端收尾与退出都通过组合根注入的端口完成，`main.ts` 只提供空闲门控闭包（owner、modal、command session、composer、turn 等状态天然属于组合根），便于控制器级测试。

### D6: 呈现门控

检查完成发现新版本后，`AutoUpdateController` 在既有 activity timer 的每个 tick（100ms）上通过组合根注入的 `canPresent` 门控尝试呈现，直到呈现或用户决策；不引入专用轮询 timer。呈现条件全部满足才弹：

- 无活跃 assistant turn、无 shell 命令、无 pending 消息 / 会话引用 / 引用准备；
- 无用户问题、工具审批、文件选择等 modal；无 command session、subagent 视图、BTW、model tuning 面板与本地错误 surface；
- MCP bootstrap 已完成（避免与启动诊断叠加）；
- composer 为空，且最近 1s 内没有任何 stdin 输入（防"刚按下 Enter/正在打字"的竞争）；

条件不满足就继续等，不降级为 toast 或 transcript 记录；本次会话内一直不空闲则保持提示待命（下次启动仍会提示）。modal 激活期间既有周期重绘跳过逻辑（`getActiveModalSurface`）自动生效，不会闪烁。

### D7: 立即更新为前台流程

选择「立即更新」后：

1. 控制器通过 `shutdown` 端口执行终端收尾（组合根从 `exit()` 抽取的共享实现：停 timer、移除 stdin/resize 监听并暂停 stdin、关视图、恢复终端与光标、写空行），但**不** `process.exit`；先 `renderer.clearFooter()` + `terminal.cleanup()`，保证后续 npm 输出不被 footer 重绘破坏；父进程至此不再消费输入或响应 resize，终端由前台子进程独占；不切换 alternate screen（沿用全项目纪律）。
2. `src/update/` 的前台更新器写一行状态文案后，以 `stdio: 'inherit'` 前台运行 `npm install -g @eumendies/echo-tui@latest`（win32 需要 `shell: true` 才能启动 `npm.cmd`），npm 输出直通用户终端。
3. 安装成功：写「更新完成，正在重新启动 echo-tui…」，用 `process.execPath` + `process.argv.slice(1)`（入口脚本与原始参数）重启，继承 stdio、保持 cwd，并在重启前向更新状态文件写入 `restartGuardAt` 短窗口标记；以子进程退出码退出。npm 全局安装会原位替换包目录，同一路径重启即运行新版本；标记让重启进程在窗口内跳过重新提示，覆盖"重启仍解析到旧副本"与安装失败两种场景，且不依赖环境变量。
4. 安装失败：写可读错误与手动命令提示（`npm install -g @eumendies/echo-tui@latest`），随后仍以当前版本重启，避免用户被甩回 shell。
5. 重启 spawn 失败（入口消失等）：写"请手动重新运行 echo-tui"并返回非零退出码。

备选（被否）：后台静默安装（用户明确要求前台可见）；按 PATH 解析 `echo-tui` 重启（可能解析到与当前进程不同的副本）；在 TUI 内用 footer 展示安装进度（npm 输出需完整可见，且安装可能要求 TTY 交互）。

### D8: 稍后提醒与忽略版本的语义

- 「稍后提醒」：仅本次会话内存标记，提示不再出现；进程退出后不持久化，下次启动若仍发现新版本会再次提示。
- 「忽略此版本」：写入 `ignoredVersion = latest`；同版本不再提示，出现更高版本时恢复提示；写入失败时降级为"本次会话忽略"（下次启动重新提示），不阻塞关闭提示。

### D9: 配置开关

- `~/.echo/config.json` 新增根节点 `updates.checkOnStartup`（默认 `true`）；`AppSettings` 增加 `checkUpdatesOnStartup: boolean`，纳入既有校验/归一化/保存管线。
- `/config` 常规 Tab 增加「启动时检查更新」行（开/关，←/→ 与 Enter 切换），与其他常规设置共用草稿、验证与显式保存；保存只更新 `updates.checkOnStartup`，保留其它节点。
- 运行时只在启动读取一次该开关；运行中修改配置不影响本次进程（与"启动时检查"语义一致），下次启动生效。

## Risks / Trade-offs

- [手写版本比较的边界（前导 v、段数不足、非数字段）] → 为比较函数建立独立单测矩阵；项目只发布纯数字版本，同数字段的不同后缀视为相等。
- [npm 全局安装可能因权限失败（EACCES 等）] → 前台错误直通终端 + 两行可读提示 + 手动命令；失败后仍重启当前版本。
- [pnpm/bun/yarn 全局安装副本会执行 `npm install -g`，可能安装到另一份副本] → v1 明确不做包管理器探测，写入设计取舍；重启进程跳过检查避免提示循环，用户在下次启动仍可选忽略该版本。
- [重启路径依赖 `process.argv[1]` 的启动形态] → 仅对包管理器安装副本可达；spawn 失败时给出手动重启提示并返回非零码。
- [检查请求对私有/镜像 registry 的兼容性] → 遵循 `npm_config_registry`；失败静默，绝不影响启动与使用。
- [提示与用户输入竞争] → D6 门控（composer 空 + 1s 输入静默 + 无回合/ modal）+ 默认焦点在「稍后提醒」双保险。
- [状态文件写失败或损坏] → 容错读取、按无状态处理；忽略语义降级为会话级，不影响 TUI 运行。

## Migration Plan

无数据迁移。旧版本不认识 `updates.checkOnStartup` 字段会原样保留（既有"保存保留未知节点"纪律已覆盖）；回滚只需移除启动钩子、input 端口、配置行与新模块，`~/.echo/update-state.json` 可保留无害。

## Open Questions

- 是否在后续迭代探测 pnpm/bun/yarn 全局安装并改用对应更新命令。
- 是否提供 `/update` 手动检查命令（复用同一检查与提示路径）。
- 是否把检查结果（跳过原因、可用版本）写入 debug 日志或 observation 事件，便于排查"为什么没提示"。
