# footer-mouse-wheel-scrolling Specification

## Purpose
TBD - created by archiving change add-footer-mouse-wheel-scrolling. Update Purpose after archive.
## Requirements
### Requirement: 仅双栏右侧预览或详情可由滚轮滚动
file picker、`/resume`、`/copy` 和 `/diff` SHALL 仅为实际可见的右侧预览/详情主体提供垂直滚轮区域。每个有效的无修饰符垂直滚轮报告 SHALL 只沿方向滚动当前选中项的右侧内容一个步长，偏移 SHALL 依据实际 viewport 可见高度钳制。滚轮在右栏产生有效滚动时 SHALL 将焦点切到 preview/detail，即使滚动前处于 list focus；无可滚动内容或到达边界时 SHALL 保持焦点、选择、偏移、预览请求和会话状态不变，且 SHALL 不产生多余重绘。

#### Scenario: 从列表焦点直接滚动右栏
- **WHEN** file picker、`/resume`、`/copy` 或 `/diff` 处于左栏焦点，鼠标在右栏可见主体滚动
- **AND** 当前预览/详情可沿该方向滚动
- **THEN** 系统 SHALL 将右侧内容滚动一步，并切换右侧焦点
- **THEN** 系统 SHALL 不改变左栏选中项或执行确认、目录进入、会话恢复、复制等动作

#### Scenario: 右栏空白主体可滚动
- **WHEN** 预览/详情有可滚动内容且鼠标落在右栏已绘制的主体空白行
- **THEN** 系统 SHALL 按对应方向滚动当前右栏内容
- **THEN** 系统 SHALL NOT 为该行生成可点击的列表项

#### Scenario: 边界、空列表及加载中
- **WHEN** 当前预览/详情为空、正在加载、不可滚动或已到对应方向边界
- **THEN** 系统 SHALL 不改变焦点、选中项、滚动偏移、预览请求或会话状态
- **THEN** 系统 SHALL 不执行多余重绘

#### Scenario: resume 预览焦点仍可鼠标选择左侧会话
- **WHEN** `/resume` 处于 preview focus 且右栏主体可见
- **THEN** 系统 SHALL 保留右栏滚轮区域及左侧可见会话条目的点击区域，且两者互不重叠
- **WHEN** 鼠标 hover 左侧可见会话条目
- **THEN** 系统 SHALL 返回 list focus、选择该会话并从顶部展示其预览；目标不变时 SHALL NOT 重复加载预览
- **WHEN** 鼠标点击左侧可见会话条目
- **THEN** 系统 SHALL 按原有语义立即恢复所点击会话；仅滚动右栏 SHALL NOT 恢复会话

### Requirement: 列表滚轮不改变选择
slash suggestion、用户问题与工具审批 choice、`/model` 和 `/mode` 的 select 选项，以及 file picker、`/resume`、`/copy`、`/diff` 的左侧列表 SHALL 保持既有 hover/点击与键盘导航语义，但 SHALL NOT 因滚轮改变选择或执行列表动作。系统 SHALL NOT 为单列或左栏选项、`more` 和主体空白行创建滚轮区域；右侧滚轮区域 SHALL NOT 扩展点击区域。

#### Scenario: 在单列选项上滚动
- **WHEN** 鼠标在 slash suggestion、choice 或 `/model`、`/mode` 的选项区滚动
- **THEN** 系统 SHALL 不改变焦点、草稿、选中项或 composer，也不确认选项
- **THEN** 相同列表的 hover、点击和键盘操作 SHALL 仍按既有语义生效

#### Scenario: 在双栏左侧列表滚动
- **WHEN** 鼠标在 file picker、`/resume`、`/copy` 或 `/diff` 的左栏条目、`more` 或空白行滚动
- **THEN** 系统 SHALL 不改变选中项、焦点、预览请求、选择集合或 transcript
- **THEN** 系统 SHALL 不执行目录进入、恢复会话、剪贴板写入或多余重绘

### Requirement: 滚轮沿用当前鼠标能力及终端原生滚动边界
系统 SHALL 仅在 `ui.mouseInteractionEnabled` 为 true、TTY 可用且当前 active consumer 声明右栏滚轮能力时处理对应区域报告。启用 tracking 期间落在左栏、单列列表、面板外、标题、边框和分隔线的滚轮 SHALL 被忽略，系统 SHALL NOT 尝试转交或回放宿主原生 scrollback。设置关闭、非 TTY/headless、unsupported surface（包括 `/effort`）及列表关闭时 SHALL 保持既有键盘和终端原生滚动路径。

#### Scenario: 鼠标开启但滚轮命中左栏或面板外
- **WHEN** 受支持 footer 开启 tracking 且滚轮落在右侧 wheel region 之外
- **THEN** 系统 SHALL 不改变列表、预览、composer 或 transcript
- **THEN** 系统 SHALL NOT 伪造宿主 scrollback 滚动

#### Scenario: 关闭设置恢复原生路径
- **WHEN** 用户关闭 UI 鼠标交互或关闭支持的列表
- **THEN** 系统 SHALL 禁用对应鼠标 tracking 并清除滚轮区域与校准
- **THEN** 用户 SHALL 能按宿主终端既有方式使用原生 scrollback
