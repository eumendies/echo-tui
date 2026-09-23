## MODIFIED Requirements

### Requirement: `/resume` 支持会话 hover 与恢复点击
`/resume` 的当前可见会话无论处于 list 还是 preview focus，hover SHALL 返回列表焦点、选中该会话、清除过期 notice，并仅在选择变化时按既有防抖规则请求其 preview；左键 activate 当前可见会话 SHALL 执行与先选中该会话后按 Enter 相同的恢复语义。删除确认、空列表和当前会话删除保护 SHALL NOT 产生会话恢复 hit region 或改变既有键盘安全语义。右侧预览滚轮 SHALL NOT 触发会话恢复。

#### Scenario: hover 会话更新 preview
- **WHEN** `/resume` 显示列表且用户 hover 一个当前可见会话（包括从右侧滚动后的 preview focus 返回）
- **THEN** 系统 SHALL 回到 list focus、选中该会话并按既有 preview controller 规则加载需要更新的 preview
- **THEN** hover SHALL NOT 恢复会话、删除会话或关闭 command session；同一会话 SHALL NOT 因回到列表重复加载 preview

#### Scenario: 点击会话恢复命中 session
- **WHEN** `/resume` 显示列表且用户左键点击一个当前可见会话（包括 preview focus）
- **THEN** 系统 SHALL 关闭 `/resume` command session 并恢复该命中会话
- **THEN** 系统 SHALL NOT 恢复窗口外、preview pane 或 stale frame 对应的会话

### Requirement: `/diff` 支持文件 hover 与选择点击
`/diff` 的当前可见左侧文件条目 hover 或左键 activate SHALL 将该文件设为 selectedIndex、切换为 list focus 并重置 detail scroll。点击文件 SHALL NOT 关闭 `/diff`，因为既有 Enter 语义是关闭面板而不是确认文件操作。左侧文件区域的滚轮 SHALL NOT 改变选择或详情；仅右侧可见 detail 主体的垂直滚轮 SHALL 滚动当前文件详情。右栏 SHALL NOT 因滚轮区域变成可点击的文件列表。

#### Scenario: hover 或点击文件更新 detail
- **WHEN** 用户 hover 或左键点击 `/diff` 当前可见左侧文件
- **THEN** 系统 SHALL 选择该文件并从 detail 顶部展示其内容
- **THEN** 系统 SHALL 保持 `/diff` command session 打开

#### Scenario: 左栏滚轮和点击 detail 不改变文件选择
- **WHEN** 用户在 `/diff` 左侧文件区滚动，或者在右侧 detail 内容左键点击
- **THEN** 系统 SHALL NOT 改变 selectedIndex、detailScroll 或 command session 状态

#### Scenario: 右栏滚轮仅移动 detail
- **WHEN** 用户在 `/diff` 当前可见右侧 detail 主体滚动
- **THEN** 系统 SHALL 在当前文件可见详情的边界内更新 detailScroll，即使此前处于 list focus
- **THEN** 系统 SHALL 保持 selectedIndex 和 command session 不变
