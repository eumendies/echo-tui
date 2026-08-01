## ADDED Requirements

### Requirement: 待发送消息遵守 footer 局部重绘和高度不变量
系统 SHALL 将 transient 待发送消息卡片纳入普通 composer footer 的统一 layout。卡片出现、更新或移除 SHALL 使用 footer-only redraw；当 terminal rows 已知时，包含 assistant pending preview、spacer、conversation reference、待发送卡片、composer、suggestions 和 status line 的 footer 总行数 SHALL 不超过 `rows - 2`。系统 SHALL 在写入新帧前按 remembered layout 清除旧 footer，且 SHALL NOT 把卡片追加为 transcript/scrollback 历史输出。

#### Scenario: 卡片出现时只重绘 footer
- **WHEN** assistant response 期间用户成功排队一条消息
- **AND** terminal columns 和 rows 未触发 destructive recovery
- **THEN** renderer SHALL 清除上一帧 footer 并绘制包含待发送卡片的新 footer
- **THEN** renderer SHALL NOT 重新追加 banner 或已提交 transcript blocks

#### Scenario: 卡片出现后 footer 仍有界
- **WHEN** 待发送卡片使 composer input surface 比上一帧更高
- **THEN** renderer SHALL 缩减可裁剪的 assistant pending preview、suggestions 或其他辅助内容
- **THEN** 新 footer layout 总行数 SHALL 不超过 `rows - 2`
- **THEN** 新 footer 的完整顶部 SHALL 保持在可见屏幕内，供下一次局部清理定位

#### Scenario: 卡片移除时清理旧高度
- **WHEN** 用户移除待发送消息且新 footer 比旧 footer 更矮
- **THEN** renderer SHALL 按旧 footer 的 remembered height 清除全部旧卡片行
- **THEN** 重绘后 SHALL NOT 残留待发送标题、预览或样式

#### Scenario: 极小终端保持合法光标和安全宽度
- **WHEN** terminal rows 或 columns 很小且待发送卡片、长 composer 和 streaming preview 同时存在
- **THEN** footer SHALL 裁剪低优先级内容并保持总高度不超过全局预算
- **THEN** 每一可见行 SHALL 不超过 safe render width
- **THEN** composer cursor row SHALL 保持在当前 footer layout 的合法可见范围内

### Requirement: destructive recovery 重放待发送卡片
系统 SHALL 将待发送消息作为当前 footer state 的一部分参与 destructive resize recovery。terminal columns 变化或 rows 变小时，完整快照 SHALL 按新尺寸重新预算并重绘待发送卡片；该重放 SHALL NOT 把待发送消息转换为 transcript record。

#### Scenario: 宽度变化后重新截断预览
- **WHEN** 当前存在待发送消息且 terminal columns 变化触发 destructive recovery
- **THEN** 系统 SHALL 按新 safe render width 重新生成有界消息预览
- **THEN** 完整快照 SHALL 包含待发送卡片、composer 和 status line 的当前状态
- **THEN** 快照 SHALL NOT 残留旧宽度卡片文本或边界

#### Scenario: 行数压缩后重新预算高度
- **WHEN** 当前存在待发送消息且 terminal rows 变小触发 destructive recovery
- **THEN** 系统 SHALL 按新的 `rows - 2` 上限重新预算整个 footer
- **THEN** 待发送消息 SHALL 继续保持 transient，不得因 recovery 写入 transcript journal
