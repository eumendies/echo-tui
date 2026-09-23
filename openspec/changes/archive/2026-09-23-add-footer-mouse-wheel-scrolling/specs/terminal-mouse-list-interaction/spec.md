## MODIFIED Requirements

### Requirement: 鼠标能力按交互列表生命周期启停
系统 SHALL 仅在 `ui.mouseInteractionEnabled` 为 `true`、stdin 与 stdout 均为 TTY、且当前可见 footer 为明确支持鼠标的交互列表时启用终端鼠标报告。支持的交互列表包括 slash suggestion、用户问题 choice、工具审批 choice、file picker，以及 handler 显式声明 pointer 能力的通用 `select`、`/resume`、`/copy` 与 `/diff` command session surface。系统 SHALL 使用支持移动、按下、释放和垂直滚轮报告的 SGR 扩展格式；当前 pointer consumer 存在匹配的可执行点击区域或右侧预览/详情滚轮区域时方可启用 tracking。在设置关闭、列表关闭、owner 切换、应用退出、信号清理或终端初始化失败时 SHALL 禁用此前启用的鼠标模式。系统 SHALL NOT 在 headless `--once`、非 TTY 路径或用户关闭 UI 鼠标交互时启用该模式。

#### Scenario: 开启 UI 鼠标交互后打开支持的交互列表
- **WHEN** `ui.mouseInteractionEnabled` 为 true
- **AND** slash suggestion、用户问题 choice、工具审批 choice、file picker，或已声明 pointer 能力的 select、resume、copy、diff command session surface 成为当前可见且接收输入的 surface
- **AND** stdin 与 stdout 均为 TTY
- **THEN** 系统 SHALL 启用 SGR 鼠标报告以接收移动、左键按下、左键释放和垂直滚轮坐标
- **THEN** 系统 SHALL 保持既有 raw mode 与 bracketed paste 行为

#### Scenario: 仅有预览滚轮区域的 surface 保持 tracking
- **WHEN** 当前 active pointer consumer 的 footer frame 没有可执行点击区域但仍有匹配身份的可见滚轮区域
- **THEN** 系统 SHALL 保持 tracking 并按当前 frame 的 CPR 定位处理滚轮
- **THEN** 系统 SHALL NOT 因滚轮区域而生成可点击数据项

#### Scenario: 关闭 UI 鼠标交互时保持终端原生滚动路径
- **WHEN** `ui.mouseInteractionEnabled` 为 false
- **AND** 当前 footer 是支持鼠标的交互列表
- **THEN** 系统 SHALL NOT 输出鼠标模式 ANSI 序列或请求用于鼠标命中的 CPR
- **THEN** 系统 SHALL 保持键盘交互，并将终端原生鼠标与 scrollback 行为留给宿主终端

#### Scenario: 关闭或替换列表时恢复鼠标模式
- **WHEN** 已启用鼠标的当前支持列表关闭、被更高优先级 surface 替换或应用退出
- **THEN** 系统 SHALL 禁用其先前启用的鼠标报告
- **THEN** 后续普通 composer 输入 SHALL NOT 因该列表残留终端鼠标模式而接收鼠标报告

#### Scenario: 非交互终端保持既有行为
- **WHEN** stdin 或 stdout 不是 TTY，或运行 headless `--once`
- **THEN** 系统 SHALL NOT 输出鼠标模式 ANSI 序列
- **THEN** 系统 SHALL 保持既有非交互输入、输出和退出语义

### Requirement: 鼠标与终端位置报告安全地解析为输入事件
系统 SHALL 将 SGR 鼠标报告作为状态化 stdin 字节流解析的一部分，并 SHALL 支持报告跨多个 chunk 到达。完整且合法的普通鼠标报告 SHALL 产生包含阶段、按键、修饰键及 1-based 屏幕行列的鼠标事件；合法且无修饰符的垂直滚轮上/下报告 SHALL 产生可区分方向和坐标的滚轮输入。水平滚轮、滚轮释放帧、未知扩展键、非法坐标与修饰键滚轮 SHALL NOT 被误判为可执行业务滚轮。系统 SHALL 仅在存在匹配的位置查询时消费终端 cursor position report；鼠标残片、未知控制序列、过长报告、无效坐标与未匹配的位置报告 SHALL NOT 变成 composer 文本或触发业务动作。

#### Scenario: 分 chunk 接收鼠标移动报告
- **WHEN** 一个合法 SGR 鼠标移动报告被拆分到两个或更多 stdin chunk
- **THEN** 系统 SHALL 在收到完整报告前不生成部分输入事件
- **THEN** 系统 SHALL 在报告完整后生成一个带正确行列的移动事件

#### Scenario: 分 chunk 接收垂直滚轮报告
- **WHEN** 一个合法无修饰符 SGR 垂直滚轮上/下报告被拆分到多个 stdin chunk
- **THEN** 系统 SHALL 在完整报告到达前不触发任何滚动
- **THEN** 系统 SHALL 解析出方向及 1-based 屏幕坐标，而 SHALL NOT 将它当作 hover、左键或 composer 文本

#### Scenario: 未支持的滚轮编码不触发业务
- **WHEN** 收到横向滚轮、带修饰键滚轮、释放帧或未知扩展按键报告
- **THEN** 系统 SHALL 不把报告作为可执行的垂直滚轮事件
- **THEN** 系统 SHALL 不确认选项或修改 composer

#### Scenario: 鼠标控制序列不污染 composer
- **WHEN** 普通 composer 可见且 stdin 收到不完整、无效或当前不应消费的鼠标/位置控制序列
- **THEN** 系统 SHALL NOT 将控制序列的字符插入 composer
- **THEN** 系统 SHALL NOT 提交 composer 或启动 slash command

#### Scenario: 仅消费待处理查询的位置回复
- **WHEN** 系统收到 cursor position report
- **AND** 当前不存在匹配且未过期的终端位置查询
- **THEN** 系统 SHALL 忽略该报告
- **THEN** 系统 SHALL NOT 将该报告作为鼠标点击、普通文本或业务输入分发

### Requirement: pointer 层通过当前消费者路由语义 target
`FooterPointerController` SHALL 仅负责终端鼠标模式、CPR 校准、frame/version 校验、坐标命中、右侧滚轮区域匹配与 hover 去重。controller SHALL 从 active input resolver 取得当前 pointer consumer；点击/hover 只命中已有数据项 hit region，垂直滚轮只命中独立的右侧预览/详情区域，并仅在对应区域的交互身份与该 consumer 匹配时转交结构化语义 target 或滚轮方向。controller SHALL NOT 直接依赖或判断用户问题、工具审批、文件选择、slash suggestion、command 名或 AppContext 的业务方法。没有匹配 pointer consumer 的 footer SHALL 保持纯键盘交互且 SHALL NOT 因候选区域启用鼠标报告。

#### Scenario: 匹配身份的鼠标命中被转交
- **WHEN** 当前 frame、CPR calibration 和 hit region 都有效
- **AND** hit region 的交互身份与当前 pointer consumer 相同
- **THEN** FooterPointerController SHALL 将该 region 的结构化 target 与 hover 或 activate 阶段转交给该 consumer
- **THEN** controller SHALL 不解释该 target 对应的业务选择、审批或文件操作

#### Scenario: 匹配身份的滚轮区域被转交
- **WHEN** 当前 frame、CPR calibration 与滚轮区域都有效
- **AND** 滚轮区域的交互身份与当前 pointer consumer 相同
- **THEN** FooterPointerController SHALL 仅转交该区域的 secondary 语义与滚轮上/下方向
- **THEN** controller SHALL 不合成键盘事件、不调用点击或 hover handler、也不识别具体业务命令

#### Scenario: 活跃消费者变化后拒绝旧身份
- **WHEN** 一个高优先级 surface 替换了之前的 pointer consumer
- **AND** 后续鼠标事件命中旧 consumer 身份的点击或滚轮区域
- **THEN** FooterPointerController SHALL 忽略该事件
- **THEN** 旧 surface SHALL NOT 改变焦点、确认选择或修改 composer

### Requirement: 鼠标命中必须使用当前有效的屏幕坐标定位
系统 SHALL 在使用鼠标坐标命中点击或滚轮区域前取得与当前 render version 对应的终端屏幕位置定位。系统 SHALL 通过终端 cursor position report 或等价可靠机制，将屏幕绝对坐标转换为 footer 相对坐标。定位不可用、超时、失配、超界或在定位后 layout 已变化时，系统 SHALL 忽略鼠标事件并保持键盘交互可用。

#### Scenario: 已校准坐标命中当前列表项
- **WHEN** 当前 footer layout 与屏幕位置定位均有效且属于同一 render version
- **AND** 鼠标事件的行列落在一个当前 hit map 区域内
- **THEN** 系统 SHALL 将事件路由到该区域所属 surface 与语义 target

#### Scenario: 已校准坐标命中当前滚轮栏位
- **WHEN** 当前 footer layout 与屏幕位置定位均有效且属于同一 render version
- **AND** 垂直滚轮报告的行列落在一个当前可见的滚轮区域内
- **THEN** 系统 SHALL 将该区域的栏位语义与方向交给当前消费者
- **THEN** 系统 SHALL NOT 将滚轮当作点击或应用级 transcript 滚动

#### Scenario: 终端无法提供可靠定位时安全降级
- **WHEN** 终端位置查询没有在实现定义的有界等待期内得到匹配回复，或回复与当前 render version 不匹配
- **THEN** 系统 SHALL 不执行任何鼠标 hover、点击或滚轮动作
- **THEN** 用户 SHALL 仍能使用既有键盘操作该列表

## ADDED Requirements

### Requirement: 当前 footer 为滚轮提供独立的版本化区域
系统 SHALL 仅为 file picker、`/resume`、`/copy` 和 `/diff` 当前可见的右侧预览/详情主体生成临时滚轮区域，与仅为可操作数据项生成的点击 hit region 分离。滚轮区域 SHALL 绑定当前 consumer identity、frame version、surface owner、secondary 栏位及相对 footer 的实际可见行列范围；右栏空白行进入滚轮区域时 SHALL NOT 变成可点击区域。单列选项与双栏左侧列表 SHALL NOT 生成滚轮区域。尾部裁剪、owner 切换、设置关闭和 resize SHALL 同步更新或移除滚轮区域；区域及定位状态 SHALL NOT 持久化。

#### Scenario: 右栏允许滚轮但不允许列表点击
- **WHEN** `/resume` 处于 preview focus，或者 file picker、`/copy`、`/diff` 右侧显示可见预览/详情
- **THEN** renderer SHALL 为右侧实际可见主体投影滚轮区域
- **THEN** renderer SHALL 不因右侧滚轮区域生成可点击的列表条目

#### Scenario: 左栏和单列选项仅保留点击区域
- **WHEN** slash suggestion、choice、select 或双栏左侧列表当前可见
- **THEN** renderer SHALL 不为这些选项投影滚轮区域
- **THEN** 既有可点击数据项 hit region SHALL 保持原有命中与业务语义

#### Scenario: 窗口化和极窄布局不泄漏过期区域
- **WHEN** footer 高度裁剪、终端宽度无法容纳对应主体栏位或 resize 导致 frame 更新
- **THEN** 最终滚轮区域 SHALL 只覆盖已绘制且仍可定位的当前行列
- **THEN** 旧 frame 或未绘制区域 SHALL NOT 可触发滚轮动作

#### Scenario: 面板外滚轮不回放终端滚动
- **WHEN** tracking 已启用而滚轮坐标落在所有滚轮区域之外
- **THEN** 应用 SHALL 消费该报告但不触发业务动作或原生 scrollback 模拟
