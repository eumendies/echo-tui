## Why

鼠标 hover 已能精准选择可见列表条目，用滚轮改变列表焦点反而容易产生意外选择。双栏面板的长预览/详情不能用 hover 滚动，仍需要按指针位置滚动右栏。

## What Changes

- 在 UI 鼠标交互开启、TTY 可用时识别无修饰符 SGR 垂直滚轮；仅 file picker、`/resume`、`/copy`、`/diff` 的右侧预览/详情主体响应。
- 即使当前处于左栏焦点，只要报告命中右栏且存在可见滚动空间，就将右栏滚动一步并切换右栏焦点；到达边界时不改变焦点或重绘。
- `/resume` 滚动右侧预览后，左侧可见会话仍可鼠标 hover 选中并回到列表焦点，点击沿用立即恢复语义。
- 单列列表、choice、slash suggestion 与双栏左侧列表继续只支持已有 hover/点击和键盘导航；列表、`more`、空白行、标题、边框及面板外的滚轮不触发应用动作。
- 独立的右栏 wheel region 绑定当前 footer frame、CPR 校准和 consumer identity；不扩大原有点击区域。tracking 开启时不尝试把面板外滚轮回放给宿主 scrollback。
- `ui.mouseInteractionEnabled` 仍默认关闭；非 TTY/headless、`/effort` 及其他不支持的 surface 不新增滚轮操作。

## Capabilities

### New Capabilities

- `footer-mouse-wheel-scrolling`: 定义双栏右侧预览/详情的滚轮方向、焦点、边界、副作用和终端 scrollback 取舍，以及列表滚轮无效规则。

### Modified Capabilities

- `terminal-mouse-list-interaction`: 安全解析、校准并按当前 consumer 路由独立的右栏滚轮区域，不改变列表点击区域。
- `command-surface-pointer-interaction`: 允许 `/diff` 右栏 detail 滚动，左栏仍由 hover/点击和键盘导航控制。
- `command-host-runtime`: 仅向显式支持的 handler 转发右栏滚轮，业务更新继续由 handler 管理。

## Impact

- SGR 输入类型、footer 区域投影、pointer controller 与 active input resolver；区域和定位不进入 transcript 或持久化。
- file picker、`/resume`、`/copy`、`/diff` 的有界右侧滚动；单列/左栏既有 hover/点击不变。
- 解析器、footer、消费者、CPR/frame 与 app 集成测试；无新增依赖，默认终端原生 scrollback 路径不变。
