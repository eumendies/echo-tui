## 1. 状态快照与 command session

- [x] 1.1 扩展 status command 的类型与状态快照，复制当前 session 的 compaction、todo 数据，并保存选中页面和各详情页滚动位置。
- [x] 1.2 扩展 status command port，从 `TranscriptContext` 构造防御性会话状态快照，保持既有账户用量查询接口不变。
- [x] 1.3 实现 status handler 的概览/压缩摘要/Todo 页面切换、详情滚动、`r` 本地刷新和现有关闭行为，确保其不写入 transcript 或会话状态。
- [x] 1.4 保持异步账户用量结果的 requestId/session 隔离，确保详情页切换或手动刷新不重新发起账户请求且不会重置页面阅读位置。

## 2. Footer 渲染

- [x] 2.1 重构 status surface 的页面投影，渲染固定页签、概览摘要、压缩摘要元信息和 Todo 进度信息。
- [x] 2.2 为 compaction 摘要实现保留 Markdown/换行结构的视觉行投影、换行和窗口化滚动，并提供未压缩空状态。
- [x] 2.3 为 Todo 列表实现原顺序、待办/完成的非颜色状态标识、悬挂缩进换行、进度统计和空状态。
- [x] 2.4 为受限宽高实现正文行预算、滚动偏移钳制和位置提示，继续遵守 safe render width、末列保护与 footer 重绘约束。

## 3. 测试与验证

- [x] 3.1 添加或更新 status command/port 测试，覆盖 compaction 与 todo 快照、页面切换、手动刷新、关闭和不触碰 transcript 的行为。
- [x] 3.2 添加 status renderer 测试，覆盖摘要与 todo 的完整可滚动投影、空状态、任务状态标识及窄终端行宽/高度约束。
- [x] 3.3 添加异步账户用量回调测试，验证切换页面、刷新或关闭后迟到结果不会覆盖当前 command session 状态。
- [x] 3.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`。

## 4. 概览信息对齐

- [x] 4.1 为 status 概览运行信息实现基于可见宽度的共享 key/value 标签列格式化，并保持字段顺序和账户用量布局不变。
- [x] 4.2 添加正常与窄终端下的概览对齐测试，并重新运行完整验证序列。

## 5. Review 后的渲染边界收敛

- [x] 5.1 让详情页在窄宽度和有限高度下生成安全的紧凑页签、Todo 标识与固定框架，保留可达正文并避免从头部裁剪。
- [x] 5.2 将 Todo 显式换行投影为独立物理行，复用现有 Todo 状态克隆并移除仅为旧测试夹具保留的生产兜底。
- [x] 5.3 补充页签、Todo 换行、极窄宽度和低高度的回归测试，并运行完整验证序列。
