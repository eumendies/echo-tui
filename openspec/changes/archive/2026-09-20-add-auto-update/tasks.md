## 1. 更新检查核心模块（src/update/）

- [x] 1.1 新增版本比较纯函数（只比三段数字，容忍前导 `v`、段数不足与非数字段；并入 `update-check` 模块）并导出
- [x] 1.2 新增 `~/.echo/update-state.json` 读写：字段 `lastCheckedAt` / `latestVersion` / `ignoredVersion` / `restartGuardAt`（重启防重弹标记），同目录临时文件加 rename 原子写，缺失或损坏按无状态处理
- [x] 1.3 新增更新检查入口：资格判定（含 `node_modules` 且非 `_npx`）、配置开关短路、重启防重弹窗口、24h TTL 缓存与 `npm_config_registry` 兼容
- [x] 1.4 registry 请求实现：`<registry>/@eumendies%2Fecho-tui/latest`、5s 超时、User-Agent、仅接受合法 `version`，失败静默不写缓存时间

## 2. 前台更新与重启（src/update/）

- [x] 2.1 新增前台更新器：`npm install -g @eumendies/echo-tui@latest`（stdio inherit、win32 走 shell）、结果文案、注入可替换的 spawn 缝
- [x] 2.2 重启逻辑：`process.execPath` + 原入口与参数、保持 cwd、继承 stdio、重启前写入状态文件短窗口防重弹标记，以子进程退出码返回；spawn 失败返回手动重启提示路径

## 3. 更新提示交互（src/app/）

- [x] 3.1 新增 `AutoUpdateController`（`src/app/auto-update-controller.ts`）：检查结果登记、tick 呈现、choice surface 投影（标题「更新可用」、版本说明、三个中文选项与描述、键位提示）、默认焦点「稍后提醒」、↑/↓ 与 Enter 处理、Esc 等同稍后提醒、决策路由 `update | later | ignore`（经注入端口完成持久化与进程编排）
- [x] 3.2 `InputEventController` 增加更新流程端口：modal 优先级排在文件选择之后，激活时消费所有输入；内聚记录最近输入时间（`getLastInputAt()`）供空闲门控读取；增补优先级与时间戳用例

## 4. 应用接线（src/app/main.ts）

- [x] 4.1 从 `exit()` 抽取共享 shutdown（停 timer、关视图与配置 watcher、恢复终端与光标、写空行），`exit()` 复用
- [x] 4.2 首帧渲染后触发更新检查；由既有 activity tick 调用 `AutoUpdateController.tick()` 按门控尝试呈现（composer 空、1s 输入静默、无回合 / pending / 引用、无其它 modal / command session / 视图 / tuning / 本地 surface、MCP bootstrap 完成），不引入专用轮询 timer
- [x] 4.3 最近输入时间由 `InputEventController` 内聚记录并在门控闭包中读取；呈现与决策无需额外 timer 生命周期管理
- [x] 4.4 决策处理（路由在 controller 内，main 注入端口）：稍后提醒进入会话级抑制；忽略此版本经 `persistIgnoredVersion` 写状态文件（失败降级会话级）；立即更新先经 `shutdown` 收尾终端，再跑前台更新并以返回码退出

## 5. 配置开关（updates.checkOnStartup）

- [x] 5.1 `app-settings-config`：新增 `checkUpdatesOnStartup`（默认 true）、布尔校验、归一化回退、`applyAppSettingsDraft` 写入 `updates.checkOnStartup` 且保留未知节点
- [x] 5.2 `commands/config/state.ts` 与 `handler.ts`：常规行 `checkUpdatesOnStartup`、←/→ 与 Enter 切换草稿
- [x] 5.3 `render/footer/config-surface.ts`：常规 Tab 渲染「启动时检查更新」行（开/关）

## 6. 测试

- [x] 6.1 `test/update/`：版本比较矩阵（相等、更高、更低、同数字段后缀、前导 v、段数不足、非法输入）
- [x] 6.2 `test/update/`：状态文件读写与容错、TTL 缓存绕过网络、忽略版本语义、资格判定（源码 / `_npx` / `node_modules`）、配置开关短路与重启防重弹窗口、失败静默
- [x] 6.3 `test/update/`：前台更新器（成功、失败、重启失败、env 注入、stdio 选项、Windows shell 分支）
- [x] 6.4 `test/app/auto-update-controller.test.js`：门控等待、surface 投影、默认焦点、键位、决策端口调用顺序与退出码、失败降级、Esc 等同稍后提醒与会话级抑制
- [x] 6.5 `test/app/input-event-controller.test.js` 增补：更新流程与其它 modal / command session 的优先级与消费行为，以及最近输入时间戳记录
- [x] 6.6 `test/app/main.test.js` 增补（fixture 驱动）：门控不满足不呈现、门控满足呈现、忽略与稍后决策、立即更新触发 teardown 与更新器（注入替换缝）
- [x] 6.7 配置面板测试增补：常规行切换与保存写入 `updates.checkOnStartup`、读取与默认值

## 7. 文档

- [x] 7.1 `README.md`：启动更新检测行为、`updates.checkOnStartup`、自更新与重启说明
- [x] 7.2 `docs/tui-architecture.md`：`src/update/` 与 `AutoUpdateController` 模块职责、启动钩子与呈现门控、input modal 优先级链更新
- [x] 7.3 不向 `echo-tui-setup` skill 增加说明：该配置面由 README 与 `/config` 面板记录，保持 skill 既有职责边界

## 8. 校验

- [x] 8.1 `npm run typecheck`
- [x] 8.2 `npm test`
- [x] 8.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 8.4 `openspec validate add-auto-update --type change`
- [x] 8.5 手动验证：以临时全局 prefix 安装本地构建（`npm install -g --prefix /tmp/echo-tui-prefix .`）后运行，检查提示弹出时机与三选项语义、`/config` 开关读写，以及 `--once` 无头路径不受影响
