# history-render-budget Specification

## Purpose
定义主会话历史重绘的可配置行数软预算、完整块后缀选择、瞬时省略提示及其与会话事实、实时输出和独立视图的隔离语义。
## Requirements
### Requirement: 历史预算与会话事实隔离
系统 SHALL 将历史渲染预算作为主会话稳定 transcript 的纯显示偏好。预算 SHALL NOT 修改原始记录、驻留起点、compaction、journal、完整记录计数、provider 输入、token 估算、Undo checkpoint 或完整历史操作的语义。

#### Scenario: 恢复后仅显示近期历史
- **WHEN** `/resume` 恢复的活跃历史超过有限预算
- **THEN** 系统 SHALL 正常安装目标会话的全部活跃记录与状态，仅限制终端历史投影
- **THEN** 下一轮 provider 输入 SHALL 与同一会话选择不限预算时等价
- **THEN** 系统 SHALL NOT 为显示截取而触发 compaction 或截断 journal

#### Scenario: 完整历史操作不受显示窗口限制
- **WHEN** 被预算省略的记录参与 `/copy`、`/fork`、历史引用、Undo 或子 Agent 回看
- **THEN** 对应操作 SHALL 保持既有的完整历史读取与有效边界语义
- **THEN** 预算提示 SHALL NOT 被当作原始消息参与这些操作

### Requirement: 按完整块从尾部应用行数软预算
系统 SHALL 在既有可见性过滤和完整块分组之后，从最新块向前按需排版，累计当前宽度和主题下的实际历史行数；有限预算达到后 SHALL 停止排版更早块，并按原顺序输出选中的连续块后缀。若外层折叠结果依赖较早过程栏展示正文，系统 SHALL 将该过程栏至结果的连续驻留块区间作为不可分选择单元，重叠依赖区间 SHALL 合并。预算 SHALL 计入块自身的空行，SHALL NOT 计入 banner、压缩/预算提示、in-flight/shell 投影或 footer。零预算 SHALL 表示不限。

#### Scenario: 保留跨过预算的完整边界块
- **WHEN** 预算为 1,000 行，最新两个可见块分别有 600 行和 700 行且前方仍有历史
- **THEN** 系统 SHALL 按原顺序输出这两个块共 1,300 行
- **THEN** 系统 SHALL NOT 为凑足 1,000 行切断边界块或排版更早块

#### Scenario: 工具对和子运行分组不被拆开
- **WHEN** 预算边界落在既有工具 call/result 对或连续子 Agent 分组之内
- **THEN** 系统 SHALL 保留整个既有渲染块及其状态、标题和内部顺序
- **THEN** 系统 SHALL NOT 因尾部选择改变并行过程过滤、外层报告压缩或意外中断提示语义

#### Scenario: 最新单块超过预算
- **WHEN** 最新可见块自身为 5,000 行且预算为 1,000 行
- **THEN** 系统 SHALL 完整输出该块并停止向前选择
- **THEN** 系统 SHALL NOT 声称最终行数受 1,000 行硬限制，也 SHALL NOT 修改或截断该块正文

#### Scenario: 折叠外层结果依赖过程报告
- **WHEN** 既有投影把单委派的外层工具结果折叠为身份和状态，正文由较早的驻留过程栏提供，且预算边界原本落在两者之间
- **THEN** 系统 SHALL 将依赖的过程栏、外层结果及两者之间的块整体纳入所选后缀，即使这使结果超过预算
- **THEN** 系统 SHALL NOT 只保留折叠状态而丢失对应正文，SHALL NOT 改变原有报告去重语义
- **THEN** 依赖关系 SHALL 仅使用当前驻留记录，不重新加载已压缩历史

#### Scenario: 不足预算或不限
- **WHEN** 所有可见历史行数不足预算，或配置值为零
- **THEN** 历史正文输出 SHALL 与相同宽度、主题、偏好下既有完整活跃投影等价
- **THEN** 系统 SHALL NOT 显示预算省略提示

#### Scenario: 隐藏内容不占预算
- **WHEN** 记录包含 provider-private 内容、关闭显示的 reasoning summary、并行子运行过程或仍由 footer 承载的内部调用
- **THEN** 系统 SHALL 先按既有规则排除这些投影
- **THEN** 它们 SHALL NOT 消耗行数预算或使应显示的近期内容被提前省略

### Requirement: 预算在昂贵排版前生效
系统 SHALL 在达到预算后跳过更早候选块的 Markdown 解析、语法高亮、折行和 ANSI 正文构建，SHALL NOT 先排版全部历史再裁剪输出。系统可以扫描活跃记录的轻量身份与结构信息，但 SHALL NOT 为统计精确省略行数重新排版被省略正文。

#### Scenario: 大量旧消息被跳过
- **WHEN** 最新若干完整块已满足预算且前方有大量较早 assistant 消息
- **THEN** 系统 SHALL 只对被选中的完整块执行正文排版
- **THEN** 增加这些旧消息的正文长度 SHALL NOT 导致它们被调用 Markdown/折行路径

#### Scenario: 分组保留跨块身份信息
- **WHEN** 可见后缀的工具或子 Agent 展示依赖较早记录的身份/终态
- **THEN** 系统 SHALL 在选择前保留所需身份与分组语义
- **THEN** 系统 SHALL NOT 为获取身份而排版较早正文

#### Scenario: 已输出标题状态遵循实际投影
- **WHEN** 破坏性重绘省略了某个 run 的全部可见块，该 run 之后又追加一个需要显示的事件
- **THEN** 系统 SHALL 保留必要的全局 run 身份，但 SHALL NOT 把被省略的标题记为本次屏幕已输出
- **THEN** 新事件 SHALL 按首次可见的既有规则带出标题，而非只输出无标题的 continuation

### Requirement: 省略历史的瞬时提示
有限预算确实排除较早可见候选块时，系统 SHALL 在所选历史之前显示一条低强调说明，表达较早历史未展开但未删除、模型上下文不受影响，并指引 `/config → 常规` 调大历史重绘预算或选择不限。提示 SHALL 为瞬时渲染内容，SHALL NOT 新增 transcript record、参与 provider 输入或改变计数；提示 SHALL NOT 冒充 compaction 结果。

#### Scenario: 压缩提示与预算提示并存
- **WHEN** 主会话已有 compaction 且其活跃后缀仍超出显示预算
- **THEN** 系统 SHALL 分别显示最多一条压缩历史提示和一条预算省略提示
- **THEN** 提示 SHALL 分别说明已压缩前缀与尚未展开活跃历史，不重复或混淆两种边界

#### Scenario: 重绘不累积提示事实
- **WHEN** 同一预算下连续 resize、主题切换或配置刷新
- **THEN** 每个新快照 SHALL 最多包含一条预算提示
- **THEN** journal 和 transcript 记录数 SHALL NOT 因提示增加

#### Scenario: 没有实际省略可见历史
- **WHEN** 全部可见块均已纳入，包括单块超出预算或较早前缀只有不可见记录的情况
- **THEN** 系统 SHALL NOT 显示预算省略提示

### Requirement: 主会话重绘入口共享预算
系统 SHALL 在主会话的 `/resume`、破坏性 resize、主题/显示偏好重绘、Undo 后重建及从 BTW/子 Agent 视图返回时使用相同预算语义。已压缩会话 SHALL 仅从活跃驻留后缀选择，未压缩会话 SHALL 从全部当前有效记录选择；不限 SHALL NOT 重新加载已压缩前缀。

#### Scenario: 新宽度重新计算行数
- **WHEN** 主会话宽度变化触发恢复
- **THEN** 系统 SHALL 按新宽度累计预算并重新选择完整块后缀，而非沿用旧宽度的行数或截取位置
- **THEN** 系统 SHALL 保持 footer、输入 surface、pending 和光标布局自洽

#### Scenario: 压缩后选择不限
- **WHEN** 已压缩主会话将历史预算设为不限并重绘
- **THEN** 系统 SHALL 显示全部可见活跃记录和压缩提示
- **THEN** 系统 SHALL NOT 为此读取或重放已压缩原文

#### Scenario: 视图 owner 隔离
- **WHEN** 用户进入 BTW 或子 Agent 独立视图，随后返回主会话
- **THEN** 独立视图 SHALL 保持既有展示范围，不受主会话预算裁剪
- **THEN** 返回主会话时 SHALL 使用最新预算恢复主会话投影，而非把独立视图记录混入主历史

### Requirement: 增量与实时输出不被历史预算裁剪
历史预算 SHALL NOT 限制普通新增记录、流式稳定前缀、in-flight 重投影或 footer pending。系统 SHALL NOT 为维持预算主动清空既有 scrollback，或在普通输入/footer tick 上新增全历史扫描。预算不构成终端 scrollback 总量上限。

#### Scenario: 恢复后继续新增消息
- **WHEN** 有限预算恢复后继续追加消息，使终端已有历史超过配置行数
- **THEN** 系统 SHALL 按既有 append 规则显示新增内容，SHALL NOT 为回收旧行主动清屏
- **THEN** 下一次主会话破坏性恢复 SHALL 重新按当前记录选择预算后缀

#### Scenario: 活跃流式响应期间重绘
- **WHEN** assistant、reasoning 或 shell 活动期间触发破坏性重绘
- **THEN** 稳定 transcript 历史 SHALL 应用预算
- **THEN** in-flight 已确定投影与 pending 尾部 SHALL 保持既有边界和去重语义，不被历史预算截去

#### Scenario: 预算不影响预览与 headless
- **WHEN** 系统显示 `/resume`/`/reference` 的候选预览或执行 `--once`
- **THEN** 对应流程 SHALL 保持既有展示和输出范围，不使用主会话历史预算裁剪内容
