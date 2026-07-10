## 1. 配置草稿与持久化

- [x] 1.1 扩展 config command 类型，为 header 草稿、header/model 详情 mode、context window 和对应 edit target 建立纯 TypeScript 数据结构。
- [x] 1.2 更新 `readLlmConfigDraft()`，完整读取 provider headers 和模型 context window，并隐藏保留模型已有的 reasoning 对象。
- [x] 1.3 更新草稿规范化和校验，校验 context window 正整数以及 header name/value 的非空、CR/LF 和大小写不敏感重复规则，且不改写隐藏 reasoning。
- [x] 1.4 更新 `saveLlmConfigDraft()`，把 header 条目序列化为 provider `headers`，写回模型 context window，并保留未展示的原始 reasoning 对象。
- [x] 1.5 增加 config editor 测试，覆盖 context window 编辑、reasoning 无损 round-trip、显式 effort `none` 保留、header 校验、敏感错误脱敏和原子保存。

## 2. Config 分层状态机

- [x] 2.1 重构 provider 详情中的模型行，使 Enter 打开 model detail，同时保留新增模型和远端模型列表流程。
- [x] 2.2 实现 header list 和 header detail 的导航、文本编辑、新增、保留已有 value、显式删除和 Esc 返回语义。
- [x] 2.3 实现 model detail 的模型 API id、默认模型、context window 和显式删除操作，且不展示 effort、summary 或 reasoning section。
- [x] 2.4 为新增、删除、设置默认模型和保存提供显式可聚焦行，并保留现有 `d`、`s` 快捷键作为非唯一加速入口。
- [x] 2.5 跟踪草稿是否变化，并实现顶层 Esc 的放弃未保存修改确认；子页面 Esc 只返回上一级并保留草稿。
- [x] 2.6 扩展 config command handler 测试，覆盖所有页面转换、字段编辑、reasoning 不可见、显式动作、取消和保存结果。

## 3. Config Surface 渲染

- [x] 3.1 更新 provider 详情布局，增加自定义 headers 入口和模型 context window 摘要，并保持 Connection/Models 等区域在高度预算内窗口化。
- [x] 3.2 实现 header list/detail renderer，确保所有 header value 始终 masked，preset headers 只显示只读管理状态。
- [x] 3.3 实现 model detail renderer，展示自动/显式 context window、默认模型状态和删除操作，不渲染 effort 或 summary。
- [x] 3.4 为新增 mode 和长列表复用现有 selected-window 与 footer maxLines 约束，保证窄终端下每行不超过 safe render width。
- [x] 3.5 增加 config surface 测试，覆盖脱敏、焦点行、窗口化、窄宽度、reasoning 字段不可见和 context window 摘要。

## 4. 中文文案统一

- [x] 4.1 盘点 `/config` 和共享 command surface renderer 的内置动作、状态、说明、section 标题和普通字段标签，将非技术英文改为中文。
- [x] 4.2 保留按键名、slash command、路径、协议名、模型 id、API/config 字段名、provider/model/header/context 技术词和用户输入原文。
- [x] 4.3 更新相关 renderer 与 command 测试，断言去 ANSI 后不再出现 `add`、`delete`、`save changes`、`loading`、`not set`、`empty` 等内置非技术英文，并验证技术标识未被改写。

## 5. 集成与文档

- [x] 5.1 验证 `/effort` 修改当前模型后，`/config` 不展示该字段且保存不会覆盖 effort 或其他 reasoning 字段。
- [x] 5.2 验证自定义 headers 继续参与远端 `list models` 和 provider client 的 preset/user header 合并，同时错误路径不泄漏 header value。
- [x] 5.3 更新 `docs/README.md` 和 `docs/tui-architecture.md`，说明新的 `/config` 页面层级、header 安全规则、context window、reasoning 不暴露策略和中文文案边界。

## 6. 验证

- [x] 6.1 运行 `npm run typecheck`。
- [x] 6.2 运行 `npm test`。
- [x] 6.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 6.4 运行 `npm start` 手工验证 provider/header/model 分层导航、中文文案、中文输入、mask、context window 编辑、reasoning 不可见、默认与删除操作、远端模型列表、保存、未保存退出确认和 Esc 返回。
- [x] 6.5 手工验证窄终端、resize、footer redraw、Ctrl+C/Ctrl+D 清理以及配置保存后真实/fake agent 启动不受影响。
