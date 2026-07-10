## 1. 现状确认

- [x] 1.1 对照当前 `/usage` renderer、command handler 和相关测试，确认柱状图渲染、日期窗口计算、主题 token 和按键事件入口。
- [x] 1.2 确认 usage 聚合数据字段已经覆盖列表所需的日期、输入、输出、缓存、命中率和总量，不引入持久化格式变更。

## 2. 渲染实现

- [x] 2.1 将 usage surface 主体从每日柱状图替换为每日数值列表/表格，保留累计 header、日期跨度、外框、分隔线和关闭提示结构。
- [x] 2.2 为每日行渲染日期、输入 token、输出 token、缓存 token 和缓存命中率，并保持日期从旧到新、默认最新窗口在底部。
- [x] 2.3 在宽度足够时渲染紧凑趋势列，并按当前可见窗口每日总 token 峰值缩放。
- [x] 2.4 实现窄窗口降级：优先隐藏趋势列，必要时压缩或裁剪次要标签，保证不会写满最后一列导致自动换行。
- [x] 2.5 使用项目现有主题 token 和中文文案，移除柱状图图例、双轴提示和 `newest at bottom · trend = daily total` 说明。

## 3. 交互实现

- [x] 3.1 将 `/usage` surface 主导航调整为 Up/Down 单步滚动、PageUp/PageDown 翻页、Home/End 跳转。
- [x] 3.2 保留 Left/Right 作为兼容别名，但 footer 可见提示使用列表滚动语义。
- [x] 3.3 确认 Enter、Esc 和 `q` 关闭 surface，且所有导航和关闭操作不修改 transcript records。

## 4. 测试与验证

- [x] 4.1 更新 footer renderer 测试，覆盖累计 header、日期跨度、每日数值行、可选趋势列、中文按键提示和窄窗口安全。
- [x] 4.2 更新 usage command handler 测试，覆盖 Up/Down、PageUp/PageDown、Home/End、Left/Right 兼容别名和关闭行为。
- [x] 4.3 运行 `npm run typecheck`。
- [x] 4.4 运行 `npm test`。
- [x] 4.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \\;`。
- [x] 4.6 手动打开 TUI 验证 `/usage` surface 的列表布局、中文提示、主题颜色、窄窗口和滚动体验。
