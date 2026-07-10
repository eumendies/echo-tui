## 1. Provider Usage 数据模型

- [x] 1.1 扩展 `ProviderUsage` 类型，加入 `outputTokens`，并确认缓存命中与缓存创建输入字段的 provider-neutral 语义。
- [x] 1.2 更新 OpenAI Responses adapter 的 usage 解析，覆盖输入、缓存命中输入和输出 token。
- [x] 1.3 更新 OpenAI Chat compatible adapter 的 usage 解析，覆盖输入、缓存命中输入和输出 token。
- [x] 1.4 更新 Anthropic compatible adapter 的 usage 解析，覆盖输入、缓存创建输入、缓存命中输入和输出 token。
- [x] 1.5 更新 provider adapter 测试，覆盖完整 usage、缺字段降级和不因 usage 缺失中断响应。

## 2. Usage 持久化账本

- [x] 2.1 新增 usage event、daily aggregate 和 usage store 类型，字段只包含非敏感统计与运行上下文。
- [x] 2.2 实现 append-only JSONL usage store，支持按月份写入、容错读取和有限日期范围聚合。
- [x] 2.3 实现 token 分类派生逻辑，包括未命中输入、总 token 和缓存命中率。
- [x] 2.4 添加 usage store 测试，覆盖写入、聚合、多日排序、坏行跳过、缺字段归零和写入失败隔离。

## 3. Agent/App 接入

- [x] 3.1 在 agent loop 收到真实 provider usage 后构造 usage event，并保持 `/context` 的最近 usage 回调不变。
- [x] 3.2 将 usage store 注入 app 或 agent runtime 的组合根，确保默认运行路径写入用户级数据目录。
- [x] 3.3 确保 abort、provider 无 usage、usage 写入失败和工具 continuation 多次 provider request 的行为符合 spec。
- [x] 3.4 添加 agent/app 层测试，覆盖 usage event 记录、无 usage 不记录、写入失败不污染 transcript 和多次 continuation 聚合。

## 4. `/usage` Command 与 Surface

- [x] 4.1 新增 `/usage` command handler，精确匹配纯命令，读取 usage 聚合并打开只读 command surface。
- [x] 4.2 新增 `UsageCommandSurface` 类型和 command host usage facade，承载聚合数据、日期窗口 offset 和 viewport 信息。
- [x] 4.3 实现 usage surface 事件处理，支持 Left/Right、PageUp/PageDown、Home/End 平移日期窗口，以及 Esc/Enter 关闭。
- [x] 4.4 实现 footer usage surface renderer，按 demo 信息架构渲染累计 header、日期跨度、每日堆叠柱状图、图例和提示，并使用现有 theme 与安全布局工具。
- [x] 4.5 在 slash command 注册和提示中加入 `/usage`，并保持 `/context` 行为不变。

## 5. 验证与文档

- [x] 5.1 添加 `/usage` command 单元测试，覆盖空状态、打开 surface、平移、跳转、关闭和 transcript 不变。
- [x] 5.2 添加 usage surface renderer 测试，覆盖多日窗口、隐藏天数、堆叠柱颜色语义、小终端裁剪和紧凑 token 格式。
- [x] 5.3 更新架构文档中 provider usage、usage store 和 command surface 的说明。
- [x] 5.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \\;`。
- [x] 5.5 手动验证交互式 TUI 中 `/usage`、`/context`、模型请求后 usage 记录、窗口平移、关闭和 resize 行为。
