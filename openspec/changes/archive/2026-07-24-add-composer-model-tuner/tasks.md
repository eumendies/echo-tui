## 1. 输入协议与调节状态

- [x] 1.1 为输入事件增加 model tuning toggle，并将 `Ctrl+T` 的 ASCII `0x14` 映射到该事件，补充普通及混合 chunk 的 key parser 测试。
- [x] 1.2 增加实例级 composer model tuning 瞬时状态，支持打开、活动字段切换、model/effort 首尾循环、取消、错误状态和草稿无修改保证，并补充纯状态测试。
- [x] 1.3 让 model 候选切换加载目标 profile 的显式 effort，未配置时使用 `medium` 起点，并测试跨 model 切换行为。

## 2. 模型配置原子应用

- [x] 2.1 在 ModelContext 中提供 model/effort 组合保存操作，通过一次配置事务更新 selected model 与目标 profile effort，并在成功后刷新缓存。
- [x] 2.2 组合保存只写入明确 effort，同时保留 reasoning summary 和其他配置字段。
- [x] 2.3 补充组合保存成功、无效 model、写入失败、缓存不提前更新及模型变化后 context usage 清理测试。

## 3. App 输入路由与状态组合

- [x] 3.1 将调节状态接入 AppContext render state，使用 `statusLine.model` 的 default/tuning 联合类型统一表达普通与暂存 model/effort，并在调节期间隐藏 slash suggestion。
- [x] 3.2 在 app 输入分发中接入 `Ctrl+T`、Tab/Shift+Tab、左右键、Enter、Esc 和再次 `Ctrl+T`，确保调节事件优先于 mode、工具授权、slash suggestion 和普通 composer 编辑。
- [x] 3.3 阻止在 active response、MCP 初始化、shell/shell-local 及高优先级交互 surface 中启动调节，并补充事件边界和草稿保留测试。
- [x] 3.4 更新 `/help` 快捷键说明，同时保持 `/model`、`/effort` 和 headless 路径行为不变。

## 4. Composer 与 status line 渲染

- [x] 4.1 扩展 footer render state 表达调节活动字段、暂存选择和脱敏保存错误，不引入独立 command surface。
- [x] 4.2 默认普通与 plan placeholder 显示 `Ctrl+T` 模型快捷提示；调节时用 `Tab 切换字段 · ←/→ 调整 · Enter 应用 · Esc 取消` 替换，有用户文本时不显示 hint，并在退出后恢复 mode placeholder。
- [x] 4.3 在 status line 中以聚焦样式区分活动 model/effort、显示明确 effort 和保存错误，并在调节期间隐藏 composer 光标。
- [x] 4.4 补充空/非空 composer、normal/plan、活动字段切换、配置错误、窄终端 safe width、resize 和光标恢复的 footer 渲染测试。

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`、`npm test` 和 JavaScript 批量语法检查，并修复所有回归。
- [x] 5.2 整理交互式手动验证清单，覆盖草稿保留、快捷键优先级、确认/取消、配置失败、slash suggestion 恢复和 model/effort 实际生效，交由用户执行。
