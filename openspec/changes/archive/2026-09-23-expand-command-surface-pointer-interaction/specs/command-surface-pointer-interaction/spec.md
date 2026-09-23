## ADDED Requirements

### Requirement: 明确支持的 command session 可接收语义 pointer target
系统 SHALL 允许 active command handler 显式声明其支持 footer pointer 语义。仅当当前 command session 的 handler 声明该能力、当前 surface 具有该 handler 支持的可见命中区域，且全局 UI 鼠标交互满足既有启用条件时，command session SHALL 成为 active pointer consumer。command runtime SHALL 将结构化 target 和 hover 或 activate 阶段转发给当前 handler，并负责与键盘事件相同的 session 更新后重绘及异步完成后重绘；runtime SHALL NOT 解释模型选择、会话恢复、复制或 diff 选择等业务 action。

#### Scenario: 支持 pointer 的 command session 成为唯一消费者
- **WHEN** 当前 active command handler 声明 pointer 处理能力
- **AND** 当前可见 surface 包含与该 command session identity 绑定的可见 hit region
- **AND** `ui.mouseInteractionEnabled` 为 true 且终端满足既有 TTY 条件
- **THEN** resolver SHALL 将该 command session 作为当前 pointer consumer
- **THEN** renderer SHALL 只为该 consumer identity 输出可执行 region

#### Scenario: 未适配 command 保持纯键盘交互
- **WHEN** 当前 active command handler 未声明 pointer 处理能力
- **THEN** command session SHALL NOT 成为 pointer consumer
- **THEN** 即使其 renderer 具有候选行布局，系统也 SHALL NOT 因该 command 启用鼠标报告或 CPR
- **THEN** 既有键盘事件分发和 surface 行为 SHALL 保持不变

#### Scenario: 异步 pointer action 完成后更新当前 session
- **WHEN** 支持 pointer 的 command handler 处理语义 target 并返回异步工作
- **THEN** command runtime SHALL 在该工作完成后按当前 active session 状态执行必要重绘
- **THEN** runtime SHALL NOT 将该 Promise 交由 terminal protocol controller 持有或等待

### Requirement: command 列表 hit region 仅表达当前可见的语义项
通用 `select`、`/resume`、`/copy` 与 `/diff` 的 renderer SHALL 仅为实际绘制且可操作的左侧或单列列表项生成 command 语义 hit region。target SHALL 使用数据集合中的绝对索引和 surface/control 种类，而不得使用屏幕坐标、窗口内相对行号或 command 名猜测。`more` 提示、标题、边框、空白行、右侧 preview/detail、被高度裁剪的条目和没有有效数据的面板 SHALL NOT 产生可执行 hit region。

#### Scenario: 窗口化列表只暴露实际可见条目
- **WHEN** `/resume`、`/copy` 或 `/diff` 因 footer 高度预算显示部分列表并带有 `more` 提示
- **THEN** hit map SHALL 只包含可见数据条目对应的绝对索引
- **THEN** 鼠标命中 `more`、被裁剪条目或右侧 preview/detail SHALL NOT 改变焦点、确认会话、切换复制选择或选择 diff 文件

#### Scenario: 双栏列表只命中左侧列表列
- **WHEN** `/resume`、`/copy` 或 `/diff` 以双栏布局显示
- **THEN** 每个列表 target 的列范围 SHALL 限制在左侧列表内容区域
- **THEN** 点击右侧 preview/detail 文本 SHALL NOT 被路由为列表操作

### Requirement: `/model` 与 `/mode` 的通用 select surface 支持 hover 与确认点击
当前 command session 的 surface 为通用 `select`，且由 `/model` 或 `/mode` 提供有效可选项时，hover 命中可见 option SHALL 将该 option 设为当前选择并保留 surface；左键 activate 命中 option SHALL 执行与先选择该 option 后按 Enter 相同的既有确认语义。无效、不可见或 stale target SHALL NOT 修改 session 或底层模型、interaction mode 设置。`/effort` 的 scale surface SHALL 保持键盘专用，且不得因本需求生成可执行 hit region。

#### Scenario: hover 选择模型或 mode option
- **WHEN** 用户将鼠标移动到当前可见的 `/model` 或 `/mode` select option
- **THEN** 系统 SHALL 将该 option 设为当前焦点
- **THEN** 系统 SHALL 继续显示同一 select surface，且 SHALL NOT 在 hover 时持久化或切换设置

#### Scenario: 点击 select option 确认选择
- **WHEN** 用户左键点击当前可见的 `/model` 或 `/mode` select option
- **THEN** 系统 SHALL 执行该命令既有的 Enter 确认语义
- **THEN** 选择成功或失败后的 session 关闭、反馈、保存及状态更新 SHALL 保持原有 handler 语义

#### Scenario: `/effort` 保持键盘专用
- **WHEN** 当前 active command session 展示 `/effort` scale surface
- **THEN** 系统 SHALL NOT 为该 surface 输出可执行 pointer hit region 或启用仅属于它的鼠标报告
- **THEN** 用户 SHALL 继续通过既有 Left、Right、Enter 与 Esc 键盘语义操作 effort

### Requirement: `/resume` 支持会话 hover 与恢复点击
`/resume` 列表 focus 状态下，hover 当前可见会话 SHALL 将该会话设为选中项、清除过期 notice 并按既有防抖规则请求其 preview；左键 activate 当前可见会话 SHALL 执行与先选中该会话后按 Enter 相同的恢复语义。删除确认、preview focus、空列表和当前会话删除保护 SHALL NOT 产生会话恢复 hit region 或改变既有键盘安全语义。

#### Scenario: hover 会话更新 preview
- **WHEN** `/resume` 的列表 focus 可见且用户 hover 一个当前可见会话
- **THEN** 系统 SHALL 选中该会话并按既有 preview controller 规则加载 preview
- **THEN** hover SHALL NOT 恢复会话、删除会话或关闭 command session

#### Scenario: 点击会话恢复命中 session
- **WHEN** `/resume` 的列表 focus 可见且用户左键点击一个当前可见会话
- **THEN** 系统 SHALL 关闭 `/resume` command session 并恢复该命中会话
- **THEN** 系统 SHALL NOT 恢复窗口外、preview pane 或 stale frame 对应的会话

### Requirement: `/copy` 支持消息 hover 与选择切换点击
`/copy` 的列表条目 hover SHALL 切换为 list focus、选中命中消息并重置 preview scroll；左键 activate 当前可见消息 SHALL 执行与先选中该消息后按 Space 相同的选择切换语义。鼠标操作 SHALL NOT 直接写入剪贴板、关闭 `/copy` surface 或触发 Enter 的复制操作。

#### Scenario: hover 消息切换 list 焦点
- **WHEN** `/copy` 显示双栏面板且用户 hover 当前可见左侧消息
- **THEN** 系统 SHALL 将 focus 切换为 list、选中该消息并显示其 preview
- **THEN** 系统 SHALL NOT 改变该消息的 selected 状态

#### Scenario: 点击消息只切换选择
- **WHEN** 用户左键点击 `/copy` 当前可见左侧消息
- **THEN** 系统 SHALL 切换该消息是否包含在 selectedIds
- **THEN** 系统 SHALL 保持 `/copy` surface 打开，且 SHALL NOT 调用 clipboard 写入

### Requirement: `/diff` 支持文件 hover 与选择点击
`/diff` 的当前可见左侧文件条目 hover 或左键 activate SHALL 将该文件设为 selectedIndex、切换为 list focus 并重置 detail scroll。点击文件 SHALL NOT 关闭 `/diff`，因为既有 Enter 语义是关闭面板而不是确认文件操作；鼠标滚轮仍 SHALL NOT 滚动 detail。

#### Scenario: hover 或点击文件更新 detail
- **WHEN** 用户 hover 或左键点击 `/diff` 当前可见左侧文件
- **THEN** 系统 SHALL 选择该文件并从 detail 顶部展示其内容
- **THEN** 系统 SHALL 保持 `/diff` command session 打开

#### Scenario: 点击 detail 不改变文件选择
- **WHEN** 用户左键点击 `/diff` 的右侧 detail 内容
- **THEN** 系统 SHALL NOT 改变 selectedIndex、detailScroll 或 command session 状态
