## 1. Command session pointer 基础设施

- [x] 1.1 扩展 footer 语义 pointer target、hit region owner 与 command handler 的可选 pointer 契约，保持 target 使用 surface/control 和完整数据绝对索引。
- [x] 1.2 为 CommandRuntime 增加 pointer capability 查询与分发入口，复用 session 更新后的同步/异步重绘生命周期，且不加入 command-specific 业务分支。
- [x] 1.3 将 command-session 接入 ActiveInputResolver 的 pointer consumer 仲裁，仅在当前 handler 显式支持且 UI 鼠标交互已开启时投影 executable identity。
- [x] 1.4 为 command runtime、resolver 和 pointer controller 添加单元测试，覆盖未适配 command 不启用鼠标、consumer 切换、stale target 以及异步完成重绘。

## 2. 首批列表 hit region 投影

- [x] 2.1 为通用 `select` renderer 的可见 option 行生成 command 语义 hit region；仅由 `/model`、`/mode` handler 声明支持，`/effort` scale 不生成 region。
- [x] 2.2 为 `/resume` 左栏当前可见会话行生成 hit region，排除 preview、删除确认、空态、边框和 `more` 行。
- [x] 2.3 为 `/copy` 与 `/diff` 左栏当前可见条目生成 hit region，限制列范围在左侧列表并排除 preview/detail、边框和 `more` 行。
- [x] 2.4 为 select、resume、copy、diff renderer 添加宽度、高度窗口化、绝对索引和无效区域测试。

## 3. Handler 语义适配

- [x] 3.1 为 `/model`、`/mode` 实现 hover 选择和左键确认，复用既有选择、保存、失败反馈与关闭语义。
- [x] 3.2 为 `/resume` 实现 hover 切换与预览请求、左键恢复命中会话，并保持删除确认与 preview focus 键盘专用。
- [x] 3.3 为 `/copy` 实现 hover 选中消息与左键 Space 等价切换，确保点击不写 clipboard 或关闭 surface。
- [x] 3.4 为 `/diff` 实现 hover/左键选择文件、list focus 与 detail scroll 重置，确保点击 detail 或文件不关闭 surface。
- [x] 3.5 为各 handler 添加 pointer 语义测试，覆盖无效索引、surface/data 不匹配与 click/hover 的键盘等价行为。

## 4. 集成验证

- [x] 4.1 添加 app 集成测试，覆盖配置开关、当前 pointer consumer、CPR/frame 失效、resize recovery 和 command session 关闭后的鼠标报告停用。
- [x] 4.2 运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`、`git diff --check` 与 `openspec validate expand-command-surface-pointer-interaction --strict`，修复回归。
- [x] 4.3 在真实 TTY 验证 `/model`、`/mode`、`/resume`、`/copy`、`/diff` 的 hover/click、窗口化、resize/CPR、关闭设置和终端 scrollback；确认 `/effort` 保持键盘专用。
