## Why

当前 `/usage` surface 使用柱状图表达每日 token 用量，适合看趋势但精度不足，用户很难直接读取每天的输入、输出、缓存和命中率数值。现在需要按照 demo 的信息架构改成列表形式，让 `/usage` 更适合作为本地用量核对界面。

## What Changes

- 将 `/usage` surface 的每日柱状图替换为按日期排列的每日用量列表/表格。
- 保留累计 header 和可见日期跨度提示，但每行直接展示日期、输入 token、输出 token、缓存 token、缓存命中率等精确数值。
- 可在宽度允许时保留紧凑趋势提示，但趋势提示只能作为辅助信息，不能替代数值列。
- 移除底部说明文案 `newest at bottom · trend = daily total`，按键提示使用项目现有中文 footer 风格。
- 调整 usage surface 的导航语义为列表滚动：Up/Down 单步滚动，PageUp/PageDown 翻页，Home/End 跳到最早/最新窗口；关闭行为保持 Enter/Esc，可继续支持 `q` 关闭。
- 不变更 usage 账本、每日聚合数据结构或 provider usage 记录逻辑。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `usage-command`: 修改 `/usage` command surface 的每日数据展示形态和日期窗口导航要求。

## Impact

- 影响 `src/render/footer/usage-surface.ts` 的 usage surface 渲染逻辑。
- 影响 `/usage` command surface 的按键处理、可见提示和相关测试。
- 需要更新 usage command 的 OpenSpec 规格和渲染/命令测试。
- 不引入新依赖，不改变持久化文件格式，不影响 agent 请求和 transcript 记录。
