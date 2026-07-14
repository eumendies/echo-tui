## 1. 实现 memory 专属 renderer

- [x] 1.1 新增 `src/render/tool-message-renderers/memory.ts`，集中识别四个 memory tool names，并安全解析现有 call arguments 和 result payload。
- [x] 1.2 为 add/read/update/remove 实现 `Remembering`、`Recalling`、`Revising`、`Forgetting` 调用摘要，隐藏 id、enabled、时间戳、scope 和 raw JSON 字段。
- [x] 1.3 为成功 `read_memory` 实现 user/agent 统一的无状态分点列表、空状态、物理行预算和截断提示。
- [x] 1.4 实现 pair-aware 规则：成功 mutation 隐藏 result，失败 mutation/read 追加 bounded 诊断，成功 read 展示列表。
- [x] 1.5 为孤立 call/result 和 malformed payload 实现不暴露 raw JSON 的安全摘要，并保证 renderer 不修改原始 record。

## 2. 接入 tool message 渲染分派

- [x] 2.1 在 `tool-message-renderer.ts` 的 pair-aware 分派中注册 memory renderer，确保相邻匹配 call/result 使用专属组合投影。
- [x] 2.2 在单 record 分派中注册 memory call/result renderer，使 transcript 孤立记录和 footer pending preview 复用同一调用摘要。
- [x] 2.3 复用现有 tool 状态颜色、safe render width 和结果截断能力，不改变 generic renderer 与其他专属工具展示。

## 3. 测试、文档与验证

- [x] 3.1 增加四个 memory tool 的 call、pending 和成功/失败 pair 渲染测试，断言 mutation 成功只显示 call 且不出现 raw JSON。
- [x] 3.2 增加 user/agent `read_memory` 列表测试，确认两者使用相同分点 marker，user memory 不展示 on/off 或 enabled 元数据。
- [x] 3.3 增加空列表、malformed call/result、孤立记录、长内容、窄终端和 record 不变性测试。
- [x] 3.4 更新架构文档中的 tool message renderer 描述，并手动检查真实 footer pending 与 transcript 的 memory 展示。
- [x] 3.5 依次运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
