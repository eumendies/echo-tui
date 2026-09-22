## MODIFIED Requirements

### Requirement: 输入事件优先级独立
系统 SHALL 将 stdin chunk 的 key parser 状态、终端协议事件消费、active input consumer 优先级、composer 编辑、快捷键和 Esc/Submit/Exit 路由保留在一个粗粒度 input event controller 协调边界内。controller SHALL 通过共享 `ActiveInputResolver` 获取当前有效消费者；该 resolver 的有序注册表 SHALL 成为输入优先级与高优先级 footer surface 选择的唯一事实来源。`main.ts` SHALL 只注册 controller 的稳定输入入口并从该共享解析边界取得 footer surface 投影，SHALL NOT 重复维护具体 modal 的优先级分支。

#### Scenario: 输入与渲染使用同一优先级来源
- **WHEN** user question、tool approval、file picker 或 auto update 中有一个或多个处于活跃状态
- **THEN** input event controller SHALL 使用 resolver 返回的最高优先级消费者处理输入
- **THEN** `main.ts` SHALL 从同一 resolver 结果选择对应的高优先级 footer surface
- **THEN** 系统 SHALL NOT 在两处分别枚举这些具体 modal 的顺序
