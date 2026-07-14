## 1. Memory 存储与上下文模型

- [x] 1.1 定义包含启用状态的 memory 条目、存储草稿/结果与 context usage `memory` segment 的共享类型。
- [x] 1.2 实现 `~/.echo/memories.json` 的读取、版本和条目校验、缺失文件空列表语义及原子保存。
- [x] 1.3 为 memory 存储补充缺失、有效、无效和写入失败场景的自动化测试。
- [x] 1.4 扩展 built-in system prompt，在每轮 provider request 中读取并格式化 transient user-managed memories，同时保持其不进入 transcript、session 和 compaction。
- [x] 1.5 将 memory 从 system prompt token 估算中拆分为独立 segment，并更新 `/context` 类型、标签、颜色和渲染。
- [x] 1.6 为 provider context 注入、memory 更新后的下一轮读取和 context usage 分类补充自动化测试。

## 2. CommandHost 与 `/memory` 管理体验

- [x] 2.1 为 `CommandHost` 增加受控 memory 列表、新增、更新和删除 facade，并在 host 中映射存储结果。
- [x] 2.2 定义 memory command surface 与会话状态，新增 `/memory` handler 并注册到默认 slash command 列表及帮助描述。
- [x] 2.3 实现列表导航、Space 启停、新增、原地编辑、`Ctrl+J` 多行输入、非空校验、Esc 取消和删除确认的 handler 状态机。
- [x] 2.4 实现 memory footer renderer，支持正确连接的卡片边框、启停 toggle、原地编辑草稿、确认提示、错误反馈及小终端安全裁剪。
- [x] 2.5 处理保存失败时的可读反馈和草稿保留，并在成功新增、更新或删除后刷新列表。
- [x] 2.6 为 CommandHost facade、slash 注册、memory handler 状态机和 renderer 投影补充自动化测试。

## 3. 文档与验证

- [x] 3.1 更新架构文档，说明 memory 文件位置、`/memory` 操作、仅启用条目注入及敏感信息会发送给 provider 的限制。
- [x] 3.2 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`，修复发现的问题。
