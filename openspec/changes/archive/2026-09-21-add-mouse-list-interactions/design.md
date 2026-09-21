## Context

Echo TUI 已通过 stdin raw mode 接收按键，在 `src/input/key-parser.ts` 中将字节流转为 `InputEvent`，并由 `InputEventController` 按 modal、command session、file picker 与 composer 的优先级分发。footer renderer 以相对 footer 的行数组进行增量重绘；各列表 renderer 当前只返回文本行与光标位置，没有可供输入层使用的行命中信息。

第一阶段仅覆盖 slash 建议、`ask_user_questions`、工具审批和 `@` 文件选择器。它们都在 footer 内渲染，但有窗口化、折行、内联输入和双栏布局，输入层不能通过固定行号或从 ANSI 文本反解析来判断目标。

终端鼠标不是 DOM 事件。支持 hover 需要启用 xterm 兼容的任意事件报告模式，并解析 SGR 扩展格式。鼠标坐标是屏幕绝对坐标，而现有 footer 布局坐标相对其临时区域；在应用启动后追加输出、正常滚动或 resize 之后，不能假设 footer 恒在屏幕底部。

## Goals / Non-Goals

**Goals:**

- 在支持的交互式终端中，为第一阶段四类列表提供 hover 聚焦与左键点击交互。
- 将鼠标协议、跨 chunk 解析、坐标命中、语义路由和业务动作分层，使后续 `/config`、`/resume`、`/skills` 等 surface 可复用。
- 保持键盘为完整交互路径；鼠标不可用、位置无法校准或报告无效时安全忽略鼠标输入。
- 只在需要时启用鼠标报告，并在所有退出路径恢复用户终端状态。

**Non-Goals:**

- 不覆盖 `/config`、`/mcp`、`/agents`、`/resume`、scale、普通 select 或 transcript 内容区。
- 不实现滚轮、拖拽、右键菜单、文本选择、双击、像素坐标或 alternate screen。
- 不在 headless `--once`、非 TTY stdout 或非 TTY stdin 中启用鼠标。
- 不以鼠标取代键盘焦点、审批安全语义、composer 编辑或已有的 Enter/Esc 行为。

## Decisions

### 1. 采用 SGR 扩展鼠标报告，并按 surface 生命周期启停

进入第一阶段的可交互列表且 stdin/stdout 均为 TTY 时，终端层启用 xterm 兼容的任意移动报告（1003）及 SGR 扩展编码（1006）；离开所有适用 surface、关闭应用、收到信号和发生初始化失败时均禁用。模式切换由终端能力控制器集中管理，业务 context 不直接写 ANSI。

选择 SGR 格式是因为它以 ASCII 十进制传输完整行列坐标，并能区分按下与释放；传统 X10 编码存在坐标范围和解析歧义。仅在可交互 surface 期间启用可降低高频移动事件与普通 composer 输入的相互影响。

备选方案是始终开启鼠标，或只开启 click（1000）。前者会产生无意义的输入和终端状态泄漏；后者不能实现 hover，均不采用。

### 2. 将输入解析器升级为通用、状态化的 ANSI 输入流解析器

`KeyParser` 保留 bracketed paste 的原子语义，并增加对完整 SGR 鼠标报告和内部终端位置报告的跨 chunk 缓冲。解析器只在接收到完整且合法的协议帧时创建鼠标事件；未知、过长、失配或过期的控制序列不得转为 `text` 事件。

鼠标事件保留最少但足够的语义：阶段（move/down/up）、按键、修饰键、1-based column/row。终端位置报告仅由终端定位请求的待处理 token 消费，不向业务输入路由暴露。

备选方案是在现有无状态 `parseKeyChunk` 前用正则处理鼠标。该方案无法正确处理 chunk 分割，会把残片污染 composer，也无法安全区分终端回复与按键序列，故不采用。

### 3. 渲染器产出临时 hit map，输入层只命中当前渲染版本

扩展 `FooterLayout`（或其内部等价对象）以携带命中区域。每个区域由相对 footer 的行/列矩形、surface owner、渲染版本以及语义 target 组成；target 使用稳定的结构化信息（例如 option absolute index、tab index、file-list entry index），不携带闭包或业务副作用。

`renderFooterLayout` 组合子 renderer 的局部坐标，完成高度裁剪后丢弃所有不可见区域。footer renderer 在实际成功绘制后保存该版本的 layout 与 hit map；新 layout、surface 切换、resize recovery 或 footer 清理会使旧 map 失效。输入层只能命中最新已绘制的 map。

备选方案是由 `InputEventController` 读取当前 `CommandSurface` 并根据硬编码行号计算目标。这会在 choice 多行 option、`more` 行、file picker 双栏、窄屏裁剪及后续 renderer 变化时失效，故不采用。

### 4. 使用终端位置校准建立屏幕绝对坐标与 footer 相对坐标的映射

首次显示适用 surface、footer 物理位置可能变化、以及 resize recovery 后，终端层请求一次标准 cursor position report（CPR）。接收当前渲染版本对应的有效回复后，结合 footer layout 的 cursor row/column 推导 footer 顶部的屏幕绝对行列。仅在该校准与 hit map 同版本时启用命中测试；定位请求超时、终端不回复、回复与版本不一致或坐标超界时，保持键盘可用且忽略鼠标。

hover 触发的焦点重绘在 footer 高度与位置未变化时复用已校准原点；若布局高度或位置改变，则先使校准失效并重新请求。每次鼠标移动不发送 CPR。

备选方案是把 footer 假设为屏幕底部，或每帧查询 CPR。前者在短会话与追加式渲染中会误命中；后者会与 spinner 高频重绘竞争并制造大量 stdin 终端回复，均不采用。

### 5. 将命中结果转换为 surface 语义，而不是通用 Enter

命中层只确定 target，owner context 决定 hover 和 click 的含义：

- slash suggestion：hover 更新建议选择；左键点击补全对应命令并追加分隔空格，不提交 composer。
- `ask_user_questions`：hover 更新当前 option 焦点；单选普通 option 点击等同聚焦后确认；多选普通 option 点击等同 `Space` 切换；`Other` 点击只聚焦内联输入，不隐式提交。
- 工具审批：hover 更新 action 焦点；普通 action 点击等同聚焦后确认；feedback 点击只聚焦输入，空反馈不得因为点击被确认。
- file picker：hover 仅聚焦左栏可见 entry；左键点击目录进入目录，点击可选择非目录切换选中状态，点击不可选择文件显示既有不可选反馈；插入 mention 仍由 Enter 明确确认。

这样保留审批、问答和文件 mention 的既有安全边界。备选方案是所有点击都合成为 `SUBMIT`；它会错误提交多选、空 feedback 与文件选择，故不采用。

### 6. 对 hover 去重并保持 modal 路由优先级

`InputEventController` 先将鼠标事件交给当前 hit-test/router；只有命中 target 相对上一次 hover 发生变化才调用 owner 的焦点更新和渲染。空白区域、非左键、过期 map、无校准或 owner 已变化的事件无副作用。现有 user question、tool approval、file picker 与 command session 的优先级保持不变；鼠标只可作用于当前最高优先级且已显示的 surface。

备选方案是每个 move 均触发 render。这会在 1003 模式下产生大量 ANSI 输出、破坏输入响应性，故不采用。

## Risks / Trade-offs

- [部分终端、multiplexer 或远程连接不回复 CPR/不支持 SGR] → 鼠标功能按 session 自动降级；键盘路径、渲染与会话语义不变，并通过单元测试覆盖无校准场景。
- [高频移动报告造成 redraw 压力] → 只在适用 surface 启用 1003，且按命中 target 去重；不对空白/同一项重复 render。
- [footer 更新、resize 与迟到报告导致点击旧区域] → hit map、CPR 回复和原点均绑定 render version；任一不匹配均忽略。
- [终端控制序列拆包或伪造输入污染 composer] → 状态解析器对协议帧设置长度、数字与阶段校验；只接受本进程尚未过期的 CPR 回复。
- [点击被误解为危险审批确认] → 仅对显式 action option 执行确认；feedback/Other 仅聚焦输入；Deny 仍遵循现有 click 即确认的明确用户操作。
- [增加多个 renderer 的元数据维护成本] → hit map 为纯临时投影，第一期仅接入四类 surface；后续 surface 逐个添加 renderer 测试。

## Migration Plan

1. 先加入 ANSI 鼠标模式、状态解析器、位置校准和无副作用 hit-test 的单元测试，不接入业务 action。
2. 扩展 footer layout 元数据并为 slash/choice/file picker renderer 登记可见区域，验证窗口化与 resize 后旧区域失效。
3. 分别接入 slash、用户问题、审批和文件选择 context，并补充语义级测试。
4. 在真实支持 SGR 的终端手工验证后发布；若发现兼容性问题，可关闭鼠标能力开关或回滚该 change，键盘路径无需数据迁移。

无需持久化迁移：鼠标模式、校准、hit map 和 hover 焦点均为进程内 transient 状态，不进入 transcript 或用户配置。

## Open Questions

- 暂无阻塞问题。实施时需要在至少一个 xterm 兼容终端和一个 tmux/ssh 路径完成手工验证，以确认具体环境对 1003、1006 与 CPR 的组合支持。
