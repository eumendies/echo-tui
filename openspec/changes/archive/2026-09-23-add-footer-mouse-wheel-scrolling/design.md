## Context

UI 鼠标交互默认关闭。开启后，现有列表已有 hover/点击精确定位；先前设计的单列与左栏滚轮逐项改动焦点体验不佳。file picker、`/resume`、`/copy`、`/diff` 均有右侧预览/详情及键盘滚动状态；`/resume` 滚动右侧后，左侧会话仍需保持可 hover/点击。终端 SGR 滚轮报告需要和点击事件分离，并沿用当前 footer 的 CPR 定位、frame/owner/consumer 检查。

## Goals / Non-Goals

**Goals:**

- 只在上述四个双栏面板的右侧实际可见主体投影 wheel region；指针位于右栏即可滚动，不要求预先聚焦右栏。
- 有效滚动每个垂直报告一步，按实际 viewport 高度钳制偏移并切换到 preview/detail focus；边界、无可滚动内容时不改状态、不重绘。
- 左栏和所有单列列表继续用 hover/点击与键盘定位；滚轮不改变列表选择，不触发确认、目录进入或剪贴板写入。
- 保持现有鼠标开关、TTY 门控、普通屏幕、点击 hit region、CPR/frame 校准和关闭 tracking 的行为。

**Non-Goals:**

- 列表滚轮、水平或修饰键滚轮、平滑滚动/加速、全文历史滚动、宿主 scrollback 回放。
- `/effort`、只读 info、confirm、auto-update 和管理表单的滚轮能力。

## Decisions

### 1. SGR 滚轮与左键/hover 独立

解析器只把合法、无修饰符、按下阶段的 SGR 垂直滚轮上/下报告转换成方向与屏幕坐标；一个报告对应一次离散步长。水平、释放、带修饰符、未知扩展键与非法坐标不形成可执行滚轮。协议层不生成键盘方向键，以免按旧焦点误滚左栏。

### 2. 仅投影右栏可见主体的 wheel region

四个双栏 renderer 各只输出 `secondary` 区域，覆盖实际绘制的右栏主体行（包括预览空白行），排除左栏、两栏分隔线、标题、边框、操作提示、被裁剪内容和 footer 外。已有 hitRegions 保持仅命中可操作列表数据项；`/resume` 的左侧会话在 preview focus 时仍保留既有命中区域，hover 返回 list focus 并选择会话，点击沿用立即恢复语义。单列/choice/slash suggestion 不输出 wheel region，也不实现 wheel consumer；file picker 和 command handler 只消费右侧滚轮。

footer 组合时同步 wheel region 的行偏移、尾部裁剪和当前 interactionId；pointer controller 在当前 frame、CPR、consumer identity 有效时才匹配区域并转发滚轮方向。命中右栏有效身份的滚轮会清除上次左侧 hover 去重键，返回原会话条目时仍能恢复列表焦点。匹配点击或右栏滚轮区域都可启用 tracking，但仅有点击能力的消费者绝不因 tracking 接受滚轮。面板外（含左栏）滚轮静默忽略，不模拟终端 scrollback。

### 3. 右栏滚动由消费者处理

resolver 选择唯一活跃消费者；CommandRuntime 仅把已校验的 `secondary` 与方向交给支持 wheel 的 handler，不能识别业务命令或执行副作用。file picker、`/resume`、`/copy`、`/diff` 使用自身实际 preview/detail viewport 计算最大滚动位置；即使焦点原在 list，右侧有可滚动内容时也滚动并切换到右侧焦点。没有有效偏移变化时保留原焦点、选择、预览请求及 frame；右侧滚动不改变列表 selectedIndex/selectedIds，不确认、不恢复会话、不写剪贴板。

### 4. 终端原生滚动边界

tracking 开启后终端通常把滚轮报告交给应用；面板外和左栏事件无法可靠返还给宿主 scrollback，因此被忽略。鼠标设置默认关闭；关闭设置、离开列表或退出时走现有 tracking 清理，让宿主终端恢复其原生行为。应用不进入 alternate screen。

## Risks / Trade-offs

- [左栏滚轮可能在 tracking 时不再触发原生 scrollback] → 明确静默忽略；默认关闭设置，用户可关闭以恢复宿主行为。
- [预览 focus 时左侧会话失去鼠标操作] → 保留列表 hit region，右栏 wheel region 仍独立于点击区域；滚轮本身不触发恢复。
- [viewport 或 resize 后坐标偏移] → 只暴露实际可见右栏并沿用尾部裁剪、当前 frame 与 CPR 校验；无法定位时安全忽略。
- [预览边界产生无效 redraw] → handler 根据实际可见高度钳制，只有偏移变化才更新焦点并重绘。

## Migration Plan

1. 从此前实现中撤销单列和左栏的 wheel region、消费入口及测试；保留 parser、CPR、右侧区域与滚动处理。
2. 覆盖右栏跨焦点滚动、左栏及单列滚轮无操作、`/resume` 从预览回到列表的 hover/点击、owner/resize/设置门控。
3. 运行全量自动化验证；可使用真实 TTY 时验证真实终端滚轮与 scrollback 取舍。

## Open Questions

- 无；本阶段仅支持无修饰符垂直滚轮滚动右侧预览/详情。
