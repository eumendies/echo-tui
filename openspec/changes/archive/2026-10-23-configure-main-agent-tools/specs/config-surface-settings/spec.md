## MODIFIED Requirements

### Requirement: Tab 配置中心
系统 SHALL 将纯 `/config` 命令投影为带“常规”“模型与 Provider”“工具”“沙箱”“外观”五个 Tab 的配置中心。配置中心 SHALL 使用现有 command runtime 和 footer command surface，不得写入 transcript、启动 agent loop、进入 tool approval flow 或切换 terminal alternate screen。纯 `/config` SHALL 默认打开“常规”Tab。

#### Scenario: 打开配置中心
- **WHEN** 用户在主 UI composer 中提交纯 `/config`
- **THEN** 系统 SHALL 清空 composer 并打开 active command session
- **THEN** 配置中心 SHALL 显示五个 Tab 并激活“常规”
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

#### Scenario: 循环切换 Tab
- **WHEN** 配置中心处于活跃状态且用户按 Tab
- **THEN** 系统 SHALL 在五个 Tab 间单向循环切换
- **THEN** Tab strip SHALL 在常规页面和模型的 provider、header、model 子页面中保持可见

#### Scenario: 切换 Tab 保留现场
- **WHEN** 用户在某个 Tab 修改草稿、移动选择位置或进入子页面后切换到其他 Tab
- **THEN** 系统 SHALL 保留原 Tab 的草稿、选择位置、子页面和文本编辑 buffer
- **THEN** 用户返回该 Tab 时 SHALL 能继续原有编辑现场

#### Scenario: 配置读取错误按 Tab 隔离
- **WHEN** `~/.echo/config.json` 无法用于常规、模型或沙箱配置读取，但 `~/.echo/theme.json` 和内置主题可用
- **AND** 用户在配置中心切换到“外观”Tab
- **THEN** 系统 SHALL 允许用户查看和选择主题
- **THEN** `config.json` 错误 SHALL NOT 阻断外观 Tab

#### Scenario: 沙箱 Tab 读取错误隔离
- **WHEN** `~/.echo/config.json` 无法用于沙箱草稿读取
- **THEN** 沙箱 Tab SHALL 以错误态展示且不影响其他 Tab
- **THEN** 用户 SHALL 仍能切换到其他 Tab 继续操作

#### Scenario: 工具 Tab 与常规设置分工
- **WHEN** 用户在配置中心浏览常规和工具 Tab
- **THEN** 工具 Tab SHALL 提供主 Agent 工具的独立开关
- **THEN** 常规 Tab SHALL NOT 再显示文件编辑方式的二选一设置
- **THEN** 常规 Tab SHALL 继续管理现有工具审批和图片压缩等非工具可见性设置

#### Scenario: 工具 Tab 读取错误隔离
- **WHEN** 主 Agent 工具偏好字段结构非法，但其他配置域可读
- **THEN** 工具 Tab SHALL 显示错误，且用户 SHALL 能继续切换并使用其他可读 Tab

### Requirement: 分域保存和统一草稿保护
“常规”、“模型与 Provider”、“工具”和“沙箱”Tab SHALL 分别提供显式保存动作，并只提交各自所有的配置字段；成功保存 SHALL 重置该 Tab 的 dirty fingerprint 且 SHALL NOT 自动关闭配置中心。“外观”主题选择 SHALL 立即持久化，不形成未保存主题草稿。配置中心在关闭顶层页面时 SHALL 检查所有已初始化 Tab 的未保存草稿。

#### Scenario: 保存一个 Tab 不提交另一个 Tab 草稿
- **WHEN** 常规和模型 Tab 都包含未保存修改，且用户只保存常规 Tab
- **THEN** 系统 SHALL 只持久化常规设置
- **THEN** 模型 Tab SHALL 继续保持未保存状态和原草稿

#### Scenario: 保存后保持配置中心打开
- **WHEN** 常规、模型、工具或沙箱 Tab 保存成功
- **THEN** 配置中心 SHALL 保持 active command session
- **THEN** 当前 Tab SHALL 显示成功反馈并把已保存草稿作为新的 dirty 比较基线

#### Scenario: 从其他 Tab 关闭时保护草稿
- **WHEN** 任一可保存 Tab 包含未保存修改，且用户在另一个 Tab 的顶层按 Esc 尝试关闭配置中心
- **THEN** 系统 SHALL 显示统一放弃确认并指出存在未保存修改的 Tab
- **THEN** 只有用户确认放弃后系统 SHALL 关闭配置中心且不写入这些草稿

#### Scenario: 模型子页面 Esc 先返回
- **WHEN** 用户在“模型与 Provider”Tab 的 provider、header 或 model 子页面按 Esc，且未处于文本编辑
- **THEN** 系统 SHALL 先返回该模型编辑器的上一级页面
- **THEN** 系统 SHALL 保留所有 Tab 草稿且不打开全局放弃确认

#### Scenario: 工具保存与其他草稿隔离
- **WHEN** 工具和常规 Tab 都存在未保存修改，且用户只保存工具 Tab
- **THEN** 系统 SHALL 只更新工具页拥有的主 Agent 禁用名单字段
- **THEN** 常规 Tab 草稿 SHALL 保持未保存，工具 Tab SHALL 更新 dirty 基线并显示下一轮生效反馈
- **THEN** 用户之后从任何 Tab 顶层关闭配置中心时 SHALL 仍得到未保存草稿保护

## ADDED Requirements

### Requirement: 主 Agent 工具页草稿与持久化

“工具”Tab SHALL 展示明确标注作用范围的主 Agent 工具列表，包括真实工具名、右对齐的简短中文说明、启用偏好及当前可用性，不展开模型使用的完整工具 description，不显示顶部策略说明或底部选中工具详情。Bash SHALL 为不可关闭的必选项；`create_todos` 与 `complete_todo` SHALL 合并为一个 Todo 配置项联动切换，其他工具 SHALL 可独立切换，`apply_patch` 与 `edit_file` SHALL 分别占一项。工具页 SHALL 使用现有 command surface 与 footer 高度预算，提供完整列表导航、Space／Enter 切换及显式保存。草稿 SHALL 在保存前不影响运行时，并纳入跨 Tab 保留和顶层统一放弃保护。

#### Scenario: 打开工具页
- **WHEN** 用户在 `/config` 切换到工具 Tab
- **THEN** 页面 SHALL 显示“主 Agent 工具”或等价作用域标识
- **THEN** 页面 SHALL 分别展示 `apply_patch` 与 `edit_file`，并在 Bash 的短说明中标注其必选；工具选择不等于安全权限的边界 SHALL 保留在配置文档
- **THEN** 未配置工具选择时 SHALL 按空禁用名单 `[]` 创建草稿，两个编辑工具及其他可用工具默认开启，不读取旧文件编辑模式

#### Scenario: 紧凑分组与中文说明
- **WHEN** 用户浏览包含内置和 MCP 工具的工具页
- **THEN** 内置分组 SHALL 仅显示“内置工具”，且只有缺少定义的保留偏好存在时才单独显示“未识别工具”分组
- **THEN** 每行 SHALL 仅显示工具名、开关和右对齐中文短说明，已知但依赖不可用的资源工具 SHALL 保留在内置分组并标注暂不可用
- **THEN** 页面 SHALL NOT 显示顶部“工具选择非权限限制”说明或底部重复选中工具详情，释放的行预算 SHALL 用于工具列表

#### Scenario: 切换普通工具只修改草稿
- **WHEN** 用户在普通工具行按 Space 或 Enter
- **THEN** 草稿 SHALL 切换该工具的启用状态，其他工具偏好保持不变
- **THEN** 系统 SHALL NOT 在显式保存前写盘或改变运行中的工具集合

#### Scenario: Todo 只占一个联动配置项
- **WHEN** 用户浏览工具页并切换 Todo 项
- **THEN** 页面 SHALL 只展示一个 Todo 开关及“创建与完成任务”短说明，配置文档 SHALL 说明其关联 `create_todos` 和 `complete_todo`
- **THEN** 系统 SHALL 同时修改两个真实工具的草稿状态，不提供分别切换的入口
- **THEN** 保存前 SHALL 不写盘或改变当前运行，保存后 SHALL 使两个工具在下一次主运行同时启用或禁用

#### Scenario: 跨 Tab 保留工具草稿
- **WHEN** 用户修改工具草稿及选择位置后切换到其他 Tab，再返回工具 Tab
- **THEN** 系统 SHALL 恢复原有草稿与选择位置
- **THEN** 关闭配置中心 SHALL 继续保护未保存的工具草稿

#### Scenario: 终端高度不足仍能访问完整列表
- **WHEN** 内置与 MCP 工具数量超过 footer 可显示高度
- **THEN** 页面 SHALL 按已有列表机制滚动并保持焦点可见
- **THEN** 用户 SHALL 能访问全部候选工具和保存动作，且渲染不越过安全宽高预算

#### Scenario: 显式保存工具偏好
- **WHEN** 用户激活工具页保存且草稿有效
- **THEN** 系统 SHALL 基于最新配置根原子更新 `tools.mainAgent.disabledTools`
- **THEN** 保存 SHALL 保留其他 `tools` 字段、旧 `fileEdit` 节点、未知配置和当前离线工具的禁用偏好
- **THEN** 系统 SHALL 安装共享配置新 snapshot、重置本页 dirty 基线，并提示下一次运行生效而不关闭配置中心

#### Scenario: 只读取不迁移写盘
- **WHEN** 配置只包含旧文件编辑模式，且用户打开或离开工具页但未保存
- **THEN** 工具页 SHALL 忽略旧模式，按缺失名单默认 `[]` 展示两个编辑工具及其他可用工具开启
- **THEN** 系统 SHALL NOT 自动创建新字段或修改旧字段

## REMOVED Requirements

### Requirement: 文件编辑工具模式设置
**Reason**: 主 Agent 的文件编辑工具不再互斥，独立工具开关取代常规 Tab 中的二选一设置及其持久化职责。
**Migration**: 完全停止读取旧 `tools.fileEdit.mode`，移除内部 `fileEditMode` 与 `includeBothFileEditTools`；主／子运行均不再使用旧编辑互斥策略。新工具配置缺失时默认 `[]`，两个编辑工具及其他可用工具默认开启。读盘不迁移；旧 JSON 字段可作为未识别数据保留但不主动清理；工具页和常规页保存各自只写本页字段。
