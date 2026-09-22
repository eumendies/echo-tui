# terminal-mouse-list-interaction Specification

## Purpose
TBD - created by archiving change add-mouse-list-interactions. Update Purpose after archive.
## Requirements
### Requirement: 鼠标能力按交互列表生命周期启停
系统 SHALL 仅在 `ui.mouseInteractionEnabled` 为 `true`、stdin 与 stdout 均为 TTY、且当前可见 footer 为第一阶段支持鼠标的交互列表时启用终端鼠标报告。系统 SHALL 使用支持移动、按下和释放坐标的 SGR 扩展报告格式，并 SHALL 在设置关闭、列表关闭、owner 切换、应用退出、信号清理或终端初始化失败时禁用此前启用的鼠标模式。系统 SHALL NOT 在 headless `--once`、非 TTY 路径或用户关闭 UI 鼠标交互时启用该模式。

#### Scenario: 开启 UI 鼠标交互后打开支持的交互列表
- **WHEN** `ui.mouseInteractionEnabled` 为 true
- **AND** slash suggestion、用户问题 choice、工具审批 choice 或 file picker 成为当前可见且接收输入的 surface
- **AND** stdin 与 stdout 均为 TTY
- **THEN** 系统 SHALL 启用 SGR 鼠标报告以接收移动、左键按下和左键释放坐标
- **THEN** 系统 SHALL 保持既有 raw mode 与 bracketed paste 行为

#### Scenario: 关闭 UI 鼠标交互时保持终端原生滚动路径
- **WHEN** `ui.mouseInteractionEnabled` 为 false
- **AND** 当前可见 footer 是支持鼠标的交互列表
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
系统 SHALL 将 SGR 鼠标报告作为状态化 stdin 字节流解析的一部分，并 SHALL 支持报告跨多个 chunk 到达。完整且合法的报告 SHALL 产生包含阶段、按键、修饰键及 1-based 屏幕行列的鼠标事件。系统 SHALL 仅在存在匹配的位置查询时消费终端 cursor position report；鼠标残片、未知控制序列、过长报告、无效坐标与未匹配的位置报告 SHALL NOT 变成 composer 文本或触发业务动作。

#### Scenario: 分 chunk 接收鼠标移动报告
- **WHEN** 一个合法 SGR 鼠标移动报告被拆分到两个或更多 stdin chunk
- **THEN** 系统 SHALL 在收到完整报告前不生成部分输入事件
- **THEN** 系统 SHALL 在报告完整后生成一个带正确行列的移动事件

#### Scenario: 鼠标控制序列不污染 composer
- **WHEN** 普通 composer 可见且 stdin 收到不完整、无效或当前不应消费的鼠标/位置控制序列
- **THEN** 系统 SHALL NOT 将控制序列的字符插入 composer
- **THEN** 系统 SHALL NOT 提交 composer 或启动 slash command

#### Scenario: 仅消费待处理查询的位置回复
- **WHEN** 系统收到 cursor position report
- **AND** 当前不存在匹配且未过期的终端位置查询
- **THEN** 系统 SHALL 忽略该报告
- **THEN** 系统 SHALL NOT 将该报告作为鼠标点击、普通文本或业务输入分发

### Requirement: 当前 footer 布局提供版本化鼠标命中区域
系统 SHALL 仅在 `ui.mouseInteractionEnabled` 为 true 时，由 footer renderer 为当前可见且可鼠标操作的列表项生成临时命中区域。每个区域 SHALL 绑定当前 render version、布局 surface owner、当前 pointer consumer 的稳定交互身份、相对 footer 的可见行列范围及结构化语义 target。高度裁剪、窗口化、`more` 提示、不可选行、用户关闭 UI 鼠标交互或被替换的 footer SHALL NOT 暴露可执行命中区域。命中区域、交互身份、屏幕定位信息与 hover 状态 SHALL NOT 写入 transcript、会话持久化或 provider request。

#### Scenario: 仅可见 option 可命中
- **WHEN** 已开启 UI 鼠标交互的支持鼠标列表因 footer 高度预算而窗口化
- **THEN** hit map SHALL 只包含当前实际渲染的可选项
- **THEN** 被裁剪的 option 与 `more` 提示行 SHALL NOT 可通过鼠标直接选择或确认

#### Scenario: 关闭设置不生成可执行命中区域
- **WHEN** `ui.mouseInteractionEnabled` 为 false
- **AND** 当前 footer 的布局 surface 本身提供候选 hit region
- **THEN** 最终 footer layout SHALL 不包含带 interaction identity 的可执行 hit region
- **THEN** pointer controller SHALL 不得因该 layout 启用鼠标报告或执行 hover、点击动作

#### Scenario: 新 render 使旧命中区域失效
- **WHEN** footer 因输入、UI 鼠标交互设置变化、surface owner 切换、resize recovery 或清理而完成新 render
- **THEN** 系统 SHALL 使上一 render version 的 hit map 失效
- **THEN** 迟到的鼠标事件 SHALL NOT 作用于旧 layout 的目标

#### Scenario: 通用 choice 布局保留消费者身份
- **WHEN** 已开启 UI 鼠标交互且不同业务消费者使用同一个 choice footer 布局
- **THEN** renderer SHALL 为当前可见 option 生成带当前消费者交互身份的 hit region
- **THEN** pointer 路由 SHALL 不通过猜测 `choice` 的业务来源来决定处理者

### Requirement: pointer 层通过当前消费者路由语义 target
`FooterPointerController` SHALL 仅负责终端鼠标模式、CPR 校准、frame/version 校验、坐标命中与 hover 去重。controller SHALL 从 active input resolver 取得当前 pointer consumer，并仅在命中区域的交互身份与该 consumer 匹配时转交结构化语义 target。controller SHALL NOT 直接依赖或判断用户问题、工具审批、文件选择、slash suggestion 或 AppContext 的业务方法。没有匹配 pointer consumer 的 footer SHALL 保持纯键盘交互且 SHALL NOT 因其 hit region 启用鼠标报告。

#### Scenario: 匹配身份的鼠标命中被转交
- **WHEN** 当前 frame、CPR calibration 和 hit region 都有效
- **AND** hit region 的交互身份与当前 pointer consumer 相同
- **THEN** FooterPointerController SHALL 将该 region 的结构化 target 与 hover 或 activate 阶段转交给该 consumer
- **THEN** controller SHALL 不解释该 target 对应的业务选择、审批或文件操作

#### Scenario: 活跃消费者变化后拒绝旧身份
- **WHEN** 一个高优先级 surface 替换了之前的 pointer consumer
- **AND** 后续鼠标事件命中旧 consumer 身份的区域
- **THEN** FooterPointerController SHALL 忽略该事件
- **THEN** 旧 surface SHALL NOT 改变焦点、确认选择或修改 composer

### Requirement: 鼠标命中必须使用当前有效的屏幕坐标定位
系统 SHALL 在使用鼠标坐标命中 footer 前取得与当前 render version 对应的终端屏幕位置定位。系统 SHALL 通过终端 cursor position report 或等价可靠机制，将屏幕绝对坐标转换为 footer 相对坐标。定位不可用、超时、失配、超界或在定位后 layout 已变化时，系统 SHALL 忽略鼠标事件并保持键盘交互可用。

#### Scenario: 已校准坐标命中当前列表项
- **WHEN** 当前 footer layout 与屏幕位置定位均有效且属于同一 render version
- **AND** 鼠标事件的行列落在一个当前 hit map 区域内
- **THEN** 系统 SHALL 将事件路由到该区域所属 surface 与语义 target

#### Scenario: 终端无法提供可靠定位时安全降级
- **WHEN** 终端位置查询没有在实现定义的有界等待期内得到匹配回复，或回复与当前 render version 不匹配
- **THEN** 系统 SHALL 不执行任何鼠标 hover 或点击动作
- **THEN** 用户 SHALL 仍能使用既有键盘操作该列表

### Requirement: hover 焦点更新受限且去重
系统 SHALL 仅在鼠标进入当前 hit map 中不同的可聚焦 target 时更新焦点和重绘。鼠标移出命中区域、停留在同一 target、使用非左键或命中当前 owner 之外的区域 SHALL NOT 改变业务状态。mouse move SHALL NOT 提交 composer、确认审批、提交用户问题、插入文件 mention 或修改 transcript。

#### Scenario: hover 移到不同选项
- **WHEN** 当前有效鼠标移动事件从一个可聚焦 target 移到另一个可聚焦 target
- **THEN** 系统 SHALL 将当前焦点更新为新 target
- **THEN** renderer SHALL 使用既有焦点样式显示该 target

#### Scenario: hover 停留不重复重绘
- **WHEN** 连续鼠标移动事件命中同一个当前聚焦 target
- **THEN** 系统 SHALL NOT 因这些事件重复更新焦点或重复触发列表重绘

### Requirement: slash 命令建议支持鼠标补全
当前 composer 显示 slash suggestion 时，系统 SHALL 为当前可见建议项提供命中区域。hover SHALL 更新建议选择；左键点击某建议 SHALL 补全该建议的命令文本并添加一个分隔空格，但 SHALL NOT 提交 composer、启动命令或改变非建议 composer 文本。

#### Scenario: hover 选择 slash 建议
- **WHEN** slash suggestion 可见且鼠标移动到一个可见建议项
- **THEN** 系统 SHALL 将该建议设为当前选择
- **THEN** 该建议 SHALL 使用既有 active 焦点样式渲染

#### Scenario: 点击 slash 建议只补全
- **WHEN** slash suggestion 可见且用户左键点击一个可见建议项
- **THEN** 系统 SHALL 将 composer 补全为该 slash command 并追加分隔空格
- **THEN** 系统 SHALL 关闭或更新已不匹配的 slash suggestion
- **THEN** 系统 SHALL NOT 提交该 composer 或开始对应 slash command session

### Requirement: choice surface 支持语义化鼠标选择
用于 `ask_user_questions` 和工具审批的 choice surface SHALL 为当前可见 option 提供命中区域。hover SHALL 更新 option 焦点。左键点击的效果 SHALL 由 option 类型和选择模式决定：单选普通 option 与工具审批普通 action 等同于聚焦后确认；多选普通 option 等同于 `Space` 切换；带 inline input 的 `Other` 或 feedback option 仅聚焦输入，且 SHALL NOT 因空输入被确认。

#### Scenario: 点击单选用户问题 option
- **WHEN** 单选 `ask_user_questions` 当前题可见
- **AND** 用户左键点击一个不带 inline input 的可见 option
- **THEN** 系统 SHALL 将该 option 作为当前题答案并执行与键盘 Enter 相同的确认语义

#### Scenario: 点击多选用户问题 option
- **WHEN** 多选 `ask_user_questions` 当前题可见
- **AND** 用户左键点击一个不带 inline input 的可见 option
- **THEN** 系统 SHALL 切换该 option 的 checked 状态
- **THEN** 系统 SHALL 保持当前问题打开且不得提交全部答案

#### Scenario: 点击 Other 或审批反馈输入
- **WHEN** 用户左键点击带 inline input 的 `Other` 或 tool approval feedback option
- **THEN** 系统 SHALL 聚焦该 inline input
- **THEN** 系统 SHALL NOT 因该点击确认用户问题或工具审批

#### Scenario: 点击工具审批 action
- **WHEN** tool approval choice surface 可见
- **AND** 用户左键点击一个不带 inline input 的可见 action option
- **THEN** 系统 SHALL 执行与先聚焦该 action 后按 Enter 相同的既有审批决议
- **THEN** 系统 SHALL 保持既有 allow、deny、会话级授权和反馈安全语义

### Requirement: 文件选择器支持鼠标列表浏览和选择
file picker SHALL 为左栏当前可见 entry 提供命中区域。hover 左栏 entry SHALL 将 list focus 和当前项切换到该 entry，并重置 preview 滚动位置。左键点击目录 SHALL 执行既有进入目录语义；点击可选择的非目录 SHALL 切换其多选状态；点击不可选择文件 SHALL 保持选择器打开并显示既有不可选择反馈。鼠标点击 SHALL NOT 直接插入 mention，mention 插入仍要求既有 Enter 确认。

#### Scenario: hover 文件列表项
- **WHEN** file picker 可见且鼠标移动到左栏一个当前可见 entry
- **THEN** 系统 SHALL 将 list 设为当前焦点并将该 entry 设为当前项
- **THEN** 系统 SHALL 重置 preview 滚动位置

#### Scenario: 点击目录进入目录
- **WHEN** file picker 可见且用户左键点击左栏一个当前可见目录
- **THEN** 系统 SHALL 执行与键盘 Right 相同的目录进入语义
- **THEN** 系统 SHALL 重置目录浏览所要求的当前项、query 和 preview 滚动状态

#### Scenario: 点击可选择文件切换多选
- **WHEN** file picker 可见且用户左键点击左栏一个当前可见的可选择非目录文件
- **THEN** 系统 SHALL 执行与键盘 Space 相同的选中状态切换
- **THEN** 系统 SHALL 保持 file picker 打开并更新已选路径摘要

#### Scenario: 文件选择仍须显式插入确认
- **WHEN** 用户通过鼠标改变 file picker 当前项或已选路径集合
- **THEN** 系统 SHALL NOT 仅因鼠标事件替换 composer trigger range 或插入 `@path` mention
- **WHEN** 用户随后按 Enter
- **THEN** 系统 SHALL 保持既有插入已选路径或当前项的语义
