## ADDED Requirements

### Requirement: 有效输入消费者由共享 resolver 解析
系统 SHALL 以结构化 `InputConsumer` 契约表示可接收语义输入事件的 footer 交互能力。契约 SHALL 支持活跃判定和键盘事件处理，并 MAY 提供 footer surface 投影或结构化鼠标 target 处理能力；系统 SHALL 允许既有 context 通过 adapter 接入，且 SHALL NOT 要求它们继承共同基类。`ActiveInputResolver` SHALL 按唯一的有序注册表、在每次解析时返回第一个活跃消费者，而 SHALL NOT 以可变的全局 active UI 字段作为事实来源。

#### Scenario: 高优先级 modal 覆盖低优先级消费者
- **WHEN** 用户问题与工具审批同时处于活跃状态
- **THEN** resolver SHALL 返回用户问题消费者
- **THEN** 工具审批、低优先级 footer 交互和 composer SHALL NOT 消费该事件

#### Scenario: 高优先级消费者关闭后恢复下层状态
- **WHEN** 一个高优先级消费者关闭，且较低优先级消费者仍处于活跃状态
- **THEN** resolver 的下一次解析 SHALL 返回该较低优先级消费者
- **THEN** 系统 SHALL NOT 要求调用方手动恢复或重新打开该较低优先级状态

### Requirement: 输入优先级与既有行为保持一致
resolver 的注册顺序 SHALL 保持既有输入优先级：用户问题、工具审批、文件选择、自动更新、subagent view、活跃 command session、会话引用准备、本地 info surface、model tuning，最后才是普通 composer fallback。普通 composer 中可见的 slash suggestion SHALL 作为低优先级输入 interceptor 接入；其处理结果 SHALL 能表达继续本次事件路由，以保持既有 Enter 补全后提交和 Tab 补全消费语义。打开尚未活跃的 subagent view、打开 model tuning 以及其他普通 composer 快捷键 SHALL 保持既有 fallback/生命周期语义。

#### Scenario: 文件选择优先于自动更新与 composer
- **WHEN** file picker 与自动更新提示同时可消费输入
- **THEN** resolver SHALL 将键盘事件交给 file picker
- **THEN** 自动更新提示和 composer SHALL NOT 响应该事件

#### Scenario: slash suggestion 的 Enter 保持提交语义
- **WHEN** 普通 composer 显示 slash suggestion 且用户按 Enter
- **THEN** suggestion interceptor SHALL 保持既有选择补全语义
- **THEN** 若既有语义要求继续提交，事件 SHALL 继续进入普通 composer 提交路径而不是被 interceptor 无条件吞掉

### Requirement: 可见 footer surface 与有效输入焦点一致
系统 SHALL 从同一 resolver 结果派生高优先级 footer `CommandSurface`，避免 render 路径与键盘路径分别维护 modal 顺序。消费者提供的全局 overlay surface SHALL 在主会话、BTW 或 subagent view owner 可见时覆盖 footer；主会话专属 command/local surface SHALL 继续仅在 main owner 可见。没有 `CommandSurface` 投影的消费者 SHALL 保持既有 composer、model tuning、reference preparation 或 owner 专属 footer 渲染方式。

#### Scenario: 用户问题覆盖 subagent view
- **WHEN** subagent view 是当前可见 owner，且用户问题成为最高优先级消费者
- **THEN** footer SHALL 显示用户问题 surface 并由该消费者接收输入
- **THEN** 用户问题关闭后 SHALL 恢复仍活跃的 subagent view 投影和既有输入语义

#### Scenario: BTW 不错误显示主 command surface
- **WHEN** BTW owner 活跃且其既有 command session 保持活跃
- **THEN** 系统 SHALL 继续渲染 BTW 专属 footer 而不是主会话 command surface
- **THEN** 高优先级 global overlay 出现和关闭后 SHALL 保持 BTW owner 的既有恢复语义

### Requirement: 输入调度保留协议与生命周期边界
`InputEventController` SHALL 继续拥有跨 stdin chunk 的 key parser、最近输入时间戳、终端协议事件优先消费，以及同一 chunk 内异步 command/submit 工作的既有等待边界。controller SHALL 将普通语义事件交由 resolver 的当前消费者处理，而 SHALL NOT 因新增 footer surface 再次直接枚举具体 modal context。消费者与 composer fallback SHALL 保持既有 Exit 放行、command session 关闭后的 pending dispatch，以及 Esc 对 pending message、会话引用、shell 命令和 assistant turn 的处理顺序。

#### Scenario: command 异步关闭后继续处理 queued message
- **WHEN** 活跃 command session 异步处理一个事件并关闭 session
- **THEN** 系统 SHALL 在该异步处理完成后保持既有 pending message dispatch 时机
- **THEN** 同一 stdin chunk 的异步工作 SHALL 继续使用既有聚合等待语义

#### Scenario: 普通 composer 的 Esc 顺序不变
- **WHEN** 没有更高优先级消费者消费 Esc
- **THEN** 系统 SHALL 继续按 pending message、会话引用、活跃 shell 命令、活跃 assistant turn 的顺序尝试处理
- **THEN** 首个成功处理者 SHALL 阻止之后的低优先级动作
