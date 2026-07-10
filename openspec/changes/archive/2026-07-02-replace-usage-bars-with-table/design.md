## Context

`/usage` 当前通过 footer command surface 展示本地 usage 账本的每日聚合结果。账本和聚合层已经提供每日输入 token、输出 token、缓存命中输入 token、缓存创建输入 token、未命中输入 token、总 token、缓存命中率和事件数，因此这次变更不需要调整数据来源。

现有 surface 主要用每日柱状图表达趋势，用户需要精确核对某一天的用量时只能从图形比例推断，精度不足。新的设计应参考 demo 的信息架构，把每日数值列表作为主体，同时继续遵守项目已有的 footer surface、主题、中文文案、ANSI 安全宽度和 command event 处理方式。

## Goals / Non-Goals

**Goals:**

- 将 `/usage` 的主体从柱状图改为每日数值列表/表格。
- 默认显示最新日期窗口，列表按日期从旧到新排列，最新日期位于可见窗口底部。
- 直接展示每一天的日期、输入、输出、缓存和命中率，让用户不依赖图形比例读取数值。
- 在宽度允许时提供简短趋势栏作为辅助视觉线索。
- 使用项目现有主题 token、footer 布局和中文按键提示。
- 将导航从横向平移提示改为列表滚动提示。

**Non-Goals:**

- 不变更 usage event 写入、每日聚合算法或持久化文件格式。
- 不增加新的 TUI 依赖或图表库。
- 不实现按模型、provider 或 mode 的筛选。
- 不保留 demo 中不符合项目语言和 footer 风格的英文说明文案。

## Decisions

### 1. 使用表格行替代柱状图主体

渲染层将 `usage-surface` 中的 chart 生成逻辑替换为 table/list 生成逻辑。surface 仍保留外框、累计 header、日期跨度行、分隔线、内容区和 footer hint，但内容区变为每日行：

- `日期`
- `输入`
- `输出`
- `缓存`
- `命中`
- `趋势`，仅在宽度足够时显示

这样可以最大化复用现有 `UsageDailyAggregate` 字段，并把用户最关心的精确值放在主阅读路径上。趋势栏只按每日总 token 相对当前可见窗口峰值缩放，用作扫视辅助，不再承担精确表达。

备选方案是保留柱状图并在悬浮或额外详情行显示数值，但 terminal footer surface 没有鼠标 hover 语义，额外详情行也会占用有限高度，不能解决“每天都可直接读取”的问题。

### 2. 列宽按优先级降级

表格应先保证关键数值完整，再考虑视觉辅助。列显示优先级为：

1. 日期
2. 输入
3. 输出
4. 缓存
5. 命中率
6. 趋势

当 terminal 宽度不足时，先隐藏趋势列；仍不足时压缩列间距和数字宽度，必要时隐藏次要列，但必须保持每行不写满最后一列，避免 terminal 自动换行破坏 footer。实现上应继续使用项目现有 `displayWidth`、`safeRenderWidth`、`padVisibleText`、`clampPlainText` 和 ANSI strip/clamp 工具。

备选方案是固定宽度并裁剪整行。该方案实现简单，但会在小窗口下截断关键数字，不适合用量核对场景。

### 3. 导航采用列表滚动语义

`/usage` 打开时仍默认定位到最新窗口。由于主体改为纵向列表，主导航应改为：

- Up/Down：窗口向更早/更新方向移动一天
- PageUp/PageDown：按窗口大小翻页
- Home/End：跳到最早/最新窗口
- Enter/Esc：关闭 surface
- `q`：关闭 surface

Left/Right 可以保留为兼容旧行为的别名，但不作为 footer 的主提示。这样符合用户对列表 surface 的预期，也和项目其他列表型 surface 的按键方向一致。

### 4. 文案和主题遵守项目风格

所有可见文案使用中文，例如 `累计`、`显示`、`输入`、`输出`、`缓存`、`命中`、`趋势`、`↑/↓ 滚动`、`PgUp/PgDn 翻页`。不出现 demo 底部的英文说明 `newest at bottom · trend = daily total`。

颜色继续来自 footer theme token，例如 `usageInput`、`usageOutput`、`usageCached`、`rail`、`frame`、`text`、`muted` 或同类现有 token。不得在 renderer 中新增硬编码业务颜色，也不得引入独立调色板。

## Risks / Trade-offs

- [Risk] 表格比柱状图占用更多横向空间 → Mitigation: 通过列优先级降级，窄窗口优先保留关键数值，趋势列只在宽度足够时显示。
- [Risk] 从 Left/Right 改成 Up/Down 可能影响旧肌肉记忆 → Mitigation: 保留 Left/Right 作为别名，但 visible hint 改成列表语义。
- [Risk] 视觉趋势弱于原柱状图 → Mitigation: 保留紧凑趋势列作为辅助，同时让精确数值成为主表达，符合这次需求重点。
- [Risk] footer 可用高度有限时列表行数减少 → Mitigation: 沿用现有 `constrainLayoutTail` 和窗口大小计算，保证 surface 不破坏 composer/footer 布局。
