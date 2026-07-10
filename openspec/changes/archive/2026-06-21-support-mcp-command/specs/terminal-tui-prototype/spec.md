## ADDED Requirements

### Requirement: MCP command surface 渲染与交互
系统 SHALL 在 footer 临时区域渲染 MCP command surface。该 surface SHALL 遵循现有 footer 局部重绘、宽度裁剪、resize recovery 和非 alternate-screen 约束，并 SHALL 不把 MCP 管理面板内容写入 transcript。

#### Scenario: MCP surface 替换普通 composer footer
- **WHEN** `/mcp` command session 处于活跃状态
- **THEN** footer SHALL 显示 MCP command surface
- **THEN** 普通 composer 输入区和 slash suggestion SHALL 暂时隐藏
- **THEN** transcript 区域 SHALL NOT 追加 MCP surface 内容

#### Scenario: MCP surface 响应 resize
- **WHEN** MCP command surface 可见且 terminal columns 变化或 rows 压缩
- **THEN** 系统 SHALL 按现有 resize recovery 规则重新渲染当前 app snapshot
- **THEN** MCP command surface SHALL 按新宽度重新计算布局并保持可读

#### Scenario: MCP surface 展示操作提示
- **WHEN** MCP command surface 可见
- **THEN** surface SHALL 展示 Space 切换、Enter 保存和 Esc 取消的操作提示
- **THEN** surface SHALL 显示 enabled 计数或等价状态摘要

#### Scenario: MCP 保存诊断使用 transient UI
- **WHEN** `/mcp` 保存后 MCP reload 产生诊断
- **THEN** 系统 SHALL 通过 command surface、info surface 或等价 transient UI 展示诊断摘要
- **THEN** 诊断 SHALL 可关闭并回到普通 composer footer
- **THEN** 诊断 SHALL NOT 作为 transcript block 持久化
