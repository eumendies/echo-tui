## 1. 常规设置配置模型

- [x] 1.1 新增常规设置类型、默认值和归一化读取逻辑，覆盖 `compaction.thresholdRatio`、`ui.slashSuggestionMaxVisible` 与 `ui.showReasoningSummary`，并对缺失、错误类型、非有限值和越界值逐字段回退。
- [x] 1.2 新增常规设置草稿校验与原子保存逻辑，只更新所有字段并保留 `llm`、`tools`、`mcp`、`hooks` 及未知根节点。
- [x] 1.3 补充常规设置读取、范围边界、默认回退、首次创建、原子 rename、无关节点保留和无效草稿拒绝测试。

## 2. 配置中心状态与输入路由

- [x] 2.1 将现有 LLM config command data 收敛为配置中心的模型子状态，新增“常规”“模型与 Provider”“外观”根 Tab 状态和可辨识 surface 类型。
- [x] 2.2 实现按 Tab 延迟初始化和错误隔离，使 `/config` 默认进入“常规”，且外观 Tab 不依赖有效 `config.json`。
- [x] 2.3 实现 Tab 单向循环导航，并在切换时保留各 Tab 的选择索引、子页面、草稿、edit target 和 edit buffer。
- [x] 2.4 新增纯常规面板控制器，支持 Up/Down 移动、Left/Right 按规定步长调整数值、开关切换、显式保存和错误反馈。
- [x] 2.5 调整模型 Tab 保存结果，使保存成功后刷新 dirty fingerprint、显示内联反馈并保持配置中心打开，同时保留现有 provider/header/model 分层导航。
- [x] 2.6 在根控制器聚合常规和模型 dirty 状态，实现跨 Tab 的统一放弃确认，并确保模型子页面 Esc 仍优先返回上一级。
- [x] 2.7 补充配置中心打开、延迟初始化、Tab 循环、现场保留、分域保存、跨 Tab dirty 确认和子页面 Esc 优先级的状态/handler 测试。

## 3. Config footer surface 与主题入口

- [x] 3.1 重构 config surface frame，在常规、模型详情、外观、错误和放弃确认视图中统一渲染单行 Tab strip、当前状态及操作提示。
- [x] 3.2 实现常规设置行、数值/开关聚焦状态、保存反馈和受限高度窗口化渲染，继续遵守 safe render width。
- [x] 3.3 实现外观 Tab 的内置主题列表、当前选中 marker、空状态和保存错误渲染。
- [x] 3.4 删除独立 `/themes` 命令入口，主题选择只通过 `/config` 的“外观”Tab 承载。
- [x] 3.5 调整主题确认流程，先更新 command session 选择状态再保存并 destructive replay；成功后保持配置中心打开，失败时保留原 theme 和 marker。
- [x] 3.6 补充宽/窄终端、受限高度、所有 Tab、嵌套模型页面、主题成功/失败及无 `/themes` 本地命令入口的 renderer 和 command 测试。

## 4. App 设置缓存与 RenderState

- [x] 4.1 增加实例级常规设置缓存，在 app 创建时读取一次，并把归一化 slash/reasoning render preferences 接入 `RenderState` 和 final render options。
- [x] 4.2 扩展 config command host 端口以读取/保存常规设置，并在保存成功后按变化类型请求 footer redraw、destructive replay 或无需立即重绘。
- [x] 4.3 扩展 `config.json` watcher，使其同时刷新 ModelContext 和常规设置缓存，合并同一次变更需要的最强重绘并避免热路径文件读取。
- [x] 4.4 补充设置缓存初始化、保存刷新、外部 watcher 刷新、变化影响分类和 model/context usage 既有刷新行为测试。

## 5. Slash suggestion 可见窗口

- [x] 5.1 让 composer surface 按候选数、用户可见上限和终端剩余高度的最小值计算 suggestion 行预算，并继续复用 selected-window 滚动。
- [x] 5.2 保持 SlashSuggestionContext 返回完整匹配集合，使 Up/Down 导航和 Tab 补全不受显示上限截断。
- [x] 5.3 补充默认上限、自定义边界、终端高度二次限制、隐藏候选滚动和非前 N 项补全测试。

## 6. Reasoning summary 显示过滤

- [x] 6.1 在 transcript block 投影边界按 render preference 过滤 `reasoning_summary`，覆盖 append record、批量 append、destructive replay 和 final render。
- [x] 6.2 保持 reasoning callback、TranscriptContext、session journal、恢复记录和 agent loop record region 无条件保存完整 summary 事实。
- [x] 6.3 在 reasoning 显示开关变化后执行 destructive replay，使关闭可隐藏历史摘要、重新开启可从 records 恢复历史摘要。
- [x] 6.4 补充隐藏新增 summary、恢复 session 隐藏、重新开启恢复、退出 final render 和 provider/压缩语义不变测试。

## 7. 可配置自动压缩阈值

- [x] 7.1 扩展压缩阈值判定和 `runCompaction` 入参以接收安全比例，并保留 0.8 默认值与 force 模式跳过阈值的行为。
- [x] 7.2 在每次 agent loop run 初始化时读取归一化压缩阈值并保存到 run state，自动压缩调用显式传入该快照。
- [x] 7.3 确保同一 tool continuation 使用固定阈值、下一 assistant run 观察新配置，且 TUI 与 `--once` 共用该语义。
- [x] 7.4 补充有效比例、默认回退、范围边界、超过/未超过、自 run 中途配置变化、下一 run 刷新和手动 force 不受影响测试。

## 8. 文档与验证

- [x] 8.1 更新 README、架构文档、`/help` 和配置示例，说明三个 Config Tab、新配置节点、有效范围、主题外观 Tab 及 reasoning summary 仅影响显示。
- [x] 8.2 检查现有 `/config`、`/model`、`/effort`、slash suggestion、session 恢复、resize 和 headless 测试并修复回归。
- [x] 8.3 运行 `npm run typecheck`、`npm test`、JavaScript 批量语法检查和 `git diff --check`。
- [x] 8.4 整理交互式手动验证清单，覆盖三个 Tab、草稿保留/放弃、常规分域保存、主题连续切换、reasoning 历史显隐、slash 滚动和配置 watcher，交由用户执行。
