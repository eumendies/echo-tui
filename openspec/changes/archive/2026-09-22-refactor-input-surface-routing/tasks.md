## 1. 输入仲裁契约

- [x] 1.1 在 `src/app/` 建立 `InputConsumer`、pointer consumer、处理结果与 `ActiveInputResolver` 的最小类型/实现，不引入继承基类或可变全局 active UI 状态。
- [x] 1.2 为 resolver 添加纯函数或控制器测试，覆盖有序优先级、最高层关闭后恢复下层、无活跃消费者和可继续路由的处理结果。
- [x] 1.3 在 `active-input-resolver.ts` 的 `createActiveInputRouting()` 按现有顺序组装用户问题、工具审批、文件选择、自动更新、subagent view、command session、引用准备、本地 info surface 与 model tuning 的 adapter，并为未来 pointer 能力保留可选扩展点。

## 2. 键盘输入与 footer 投影迁移

- [x] 2.1 迁移 `InputEventController`，使其保留 parser、协议事件和 Promise 聚合边界，并通过 resolver 分发活跃消费者，不再直接持有或按分支枚举具体 modal context。
- [x] 2.2 保留并测试普通 composer fallback、slash suggestion 的 Tab/Enter 继续路由、Ctrl+O/model tuning 激活、Esc 优先级、Exit 放行及 command session 关闭后的 pending message dispatch。
- [x] 2.3 迁移 `main.ts` 的 footer `CommandSurface` 选择，使用 resolver 的投影结果消除重复 modal OR 链，同时保持 main、BTW、subagent view 三类 render owner 与全局 overlay 的既有边界。
- [x] 2.4 调整自动更新呈现门控及相关调用点，使其读取共享仲裁状态且保持现有空闲条件和最低优先级语义。

## 3. 鼠标路由解耦

- [x] 3.1 扩展临时 render/hit-region 数据，传递当前 pointer consumer 的稳定 `interactionId`，并更新 footer renderer 仅为当前可见、可操作项生成带该身份的区域。
- [x] 3.2 重构 `FooterPointerController`：保留鼠标模式、CPR、frame/version、坐标命中和 hover 去重，仅通过 resolver 获取当前 pointer consumer 并转交语义 target；移除对业务 context 与 AppContext 的直接依赖。
- [x] 3.3 为 slash suggestion、用户问题、工具审批和 file picker 提供 pointer adapter，保持 hover、点击、inline input、多选、审批与文件插入前确认的既有语义。
- [x] 3.4 为 pointer controller 与 renderer 添加测试，覆盖匹配身份转发、consumer 切换/旧 frame 拒绝、无 pointer consumer 时禁用鼠标，以及既有 CPR 超时安全降级。

## 4. 回归验证

- [x] 4.1 更新输入控制器、main render-state 和相关 context 测试，覆盖 modal 覆盖 subagent/BTW、关闭后恢复 owner，以及 command surface 不在 BTW footer 错显。
- [x] 4.2 运行 `npm run typecheck`、`npm test` 与 `find bin src test scripts -name '*.js' -exec node --check {} \;` 并修复回归。
- [x] 4.3 按仓库交互清单手工验证 TTY 下 composer/slash、文件选择、用户问题、工具审批、自动更新、subagent view、BTW、鼠标 hover/点击、resize/CPR 以及 Ctrl+C/Ctrl+D 清理；验证 headless `--once` 不启用鼠标模式。
