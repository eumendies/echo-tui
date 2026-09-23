## 1. 协议与当前帧定位

- [x] 1.1 解析无修饰符 SGR 垂直滚轮，拒绝无效坐标、释放/横向/修饰符与未知键，覆盖分 chunk 和连续报告。
- [x] 1.2 为 footer 快照提供独立 wheel region，按当前 interactionId、CPR、frame 与可见行列路由；保持点击/hover 原路径和 TTY/设置门控。
- [x] 1.3 覆盖滚轮 parser、区域组合/裁剪、consumer identity、owner/resize 与仅 wheel region 的协议测试。

## 2. 收窄至右栏预览

- [x] 2.1 从 slash suggestion、choice 和通用 select 移除 wheel region、导航状态方法和滚轮 handler；保持已有 hover/点击与键盘行为。
- [x] 2.2 为 file picker、`/resume`、`/copy`、`/diff` 只保留右侧预览/详情主体的 wheel region，包含右栏空白行但排除左栏、分隔线、边框、标题和提示。
- [x] 2.3 从四个双栏消费者移除左栏滚轮导航，保留从 list focus 直接有效滚动右栏、按实际 viewport 钳制并切换右栏焦点；边界不重绘、不确认或修改选中项。
- [x] 2.4 更新 renderer、消费者、command runtime 与 app 集成测试：左栏/单列滚轮无效、hover/点击不变、右栏跨焦点、CPR/frame/tracking、空态和窄屏安全降级。
- [x] 2.5 修复 `/resume` 右栏滚动后左侧鼠标失效：保留会话 hit region，滚轮后允许原条目再次 hover 返回列表焦点、点击沿用立即恢复语义，并补回归测试。

## 3. 校验与手动验收

- [x] 3.1 依次运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`、`git diff --check` 和 `openspec validate add-footer-mouse-wheel-scrolling --strict`，修复回归。
- [x] 3.2 在真实 TTY 验证四个双栏右侧滚轮（包括从 list focus 直接滚动、边界与空白行）、左栏和单列滚轮无效、`/resume` 滚动后左栏 hover/点击、设置开启/关闭、resize 与面板外 scrollback 取舍；确认关闭 tracking 后宿主原生滚动恢复。
