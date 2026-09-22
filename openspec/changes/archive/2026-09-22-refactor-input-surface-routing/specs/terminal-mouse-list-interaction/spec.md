## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 当前 footer 布局提供版本化鼠标命中区域
系统 SHALL 由 footer renderer 为当前可见且可鼠标操作的列表项生成临时命中区域。每个区域 SHALL 绑定当前 render version、布局 surface owner、当前 pointer consumer 的稳定交互身份、相对 footer 的可见行列范围及结构化语义 target。高度裁剪、窗口化、`more` 提示、不可选行和被替换的 footer SHALL NOT 暴露可执行命中区域。命中区域、交互身份、屏幕定位信息与 hover 状态 SHALL NOT 写入 transcript、会话持久化或 provider request。

#### Scenario: 仅可见 option 可命中
- **WHEN** 一个支持鼠标的列表因 footer 高度预算而窗口化
- **THEN** hit map SHALL 只包含当前实际渲染的可选项
- **THEN** 被裁剪的 option 与 `more` 提示行 SHALL NOT 可通过鼠标直接选择或确认

#### Scenario: 新 render 使旧命中区域失效
- **WHEN** footer 因输入、surface owner 切换、resize recovery 或清理而完成新 render
- **THEN** 系统 SHALL 使上一 render version 的 hit map 失效
- **THEN** 迟到的鼠标事件 SHALL NOT 作用于旧 layout 的目标

#### Scenario: 通用 choice 布局保留消费者身份
- **WHEN** 不同业务消费者使用同一个 choice footer 布局
- **THEN** renderer SHALL 为当前可见 option 生成带当前消费者交互身份的 hit region
- **THEN** pointer 路由 SHALL 不通过猜测 `choice` 的业务来源来决定处理者
