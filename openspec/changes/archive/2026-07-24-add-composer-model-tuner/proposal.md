## Why

当前用户需要分别打开 `/model` 和 `/effort` surface 才能调整模型策略，这会打断 composer 中的输入草稿，也不适合频繁切换。增加 composer 内的快捷调节模式，可以在保留草稿的同时快速完成 model 与 effort 的全局选择。

## What Changes

- 增加 `Ctrl+T` 快捷键，用于从空闲 composer 进入或退出 model/effort 调节模式。
- 调节模式下使用 `Tab` 或 `Shift+Tab` 切换活动字段，使用左右方向键调整候选值，使用 `Enter` 原子应用 model 与 effort，使用 `Esc` 取消。
- 调节过程保留 composer 草稿与光标，不追加 transcript record；确认后持久化全局模型配置并刷新 status line。
- 在 status line 中高亮当前活动的 model 或 effort 字段，不打开独立 command surface。
- 移除普通 composer 与调节态 effort segment 的圆点前缀，减少 status line 宽度占用。
- 当 composer 为空时，以调节操作提示替换原始 placeholder；composer 已有用户文本时不显示该提示。
- 响应中、MCP 初始化中、shell/shell-local 模式以及其他交互 surface 活跃时，不启动调节模式。

## Capabilities

### New Capabilities

- `composer-model-tuning`: 定义通过 `Ctrl+T` 在 composer 内暂存、浏览、确认或取消全局 model/effort 选择的输入、渲染和持久化行为。

### Modified Capabilities

无。

## Impact

- 影响输入事件定义和 raw terminal key sequence 解析。
- 影响 app 输入分发优先级、composer/model 瞬时状态和模型配置写入边界。
- 影响普通 composer placeholder、status line model/effort segment 及光标显示。
- 需要补充 key parser、状态控制、模型配置持久化、footer 渲染和应用事件路由测试。
- 不新增第三方依赖，不改变 transcript/session 格式、provider adapter 或 headless `--once` 行为。
