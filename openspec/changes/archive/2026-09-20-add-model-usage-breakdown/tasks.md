## 1. Usage 聚合与类型

- [x] 1.1 在 usage 类型中定义按 `(providerType, model)` 聚合的模型用量结果，并为每日查询补充 provider 类型和模型标识过滤条件。
- [x] 1.2 在 usage store 中实现按模型聚合、缓存命中率和总 token 占比计算；保持既有 JSONL schema、容错读取与日期/项目过滤语义不变。
- [x] 1.3 为按模型聚合、同名跨 provider 隔离、单模型按日过滤、零输入命中率/零总量占比和历史 event 兼容性添加 store 测试。

## 2. `/usage` 命令状态与交互

- [x] 2.1 扩展 usage command surface 与 handler 数据，显式表示按日、按模型和单模型按日明细视图，以及模型选择和各自滚动偏移。
- [x] 2.2 保持 `/usage` 默认按日视图，处理 Tab 顶层切换、模型列表选择/翻页/跳转、Enter 下钻及 Esc/Backspace 返回的键盘交互。
- [x] 2.3 更新 `/usage` 命令描述、中文标题和按键提示，使各视图的可用操作与关闭语义一致。

## 3. Footer 渲染

- [x] 3.1 为按模型总览渲染累计 header、带 provider 的模型身份、输入/输出/总量、缓存统计、命中率、event 数、选中状态和相对用量提示。
- [x] 3.2 为单模型按日明细复用每日表格投影，并显示模型身份及仅属于该模型的累计和日期行。
- [x] 3.3 实现模型列表的可见窗口和窄终端渐进式列裁剪，确保安全宽度、最大行数和无末列自动换行约束。

## 4. 验证

- [x] 4.1 为 usage command handler 添加默认视图、切换、选择、下钻、返回、关闭及不写 transcript 的测试。
- [x] 4.2 为 usage footer renderer 添加宽屏完整列、窄屏关键列保留、长模型名、模型窗口导航和单模型明细投影测试。
- [x] 4.3 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`，修复本变更引入的问题。

## 5. 日期下钻与配置 provider ID 修订

- [x] 5.1 在解析后的 LLM 配置与 usage event 中传递可选 provider ID，并保持历史 JSONL event 的 schema 兼容。
- [x] 5.2 将按模型聚合身份改为 provider ID 与模型标识，缺失 provider ID 时回退 provider 类型，并覆盖单日聚合和稳定排序。
- [x] 5.3 将 `/usage` command 改为可选择的日期列表；Enter 查询并打开选中日期的模型明细，Esc/Backspace 返回原日期选择。
- [x] 5.4 将 usage renderer 改为日期选中标记与当日模型列表，模型身份显示 `provider_id/model`，并把最大卡片宽度增至 112 列。
- [x] 5.5 更新 usage store、provider usage 写入、command 和 renderer 测试，覆盖历史 provider 回退、单日下钻、长 provider/model 标签和窄终端布局。
- [x] 5.6 运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;` 与严格 OpenSpec 校验。
