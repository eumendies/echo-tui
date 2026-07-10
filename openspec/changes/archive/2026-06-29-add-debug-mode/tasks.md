## 1. Debug 模块与启动开关

- [x] 1.1 新增 debug 类型和上下文模块，提供默认 disabled 实例、enabled 实例、`emit`、`close`、`logPath` 等窄接口。
- [x] 1.2 实现 debug 环境变量解析，支持 `ECHO_TUI_DEBUG=1` 启用和 `ECHO_TUI_DEBUG_LOG` 指定日志路径。
- [x] 1.3 实现 JSONL writer，包含 timestamp、递增 seq、event 和 payload，并保证写入失败不抛出到主流程。
- [x] 1.4 实现摘要化/脱敏 helper，用于文本长度、hash、截断预览和 provider 配置敏感字段过滤。

## 2. 启动脚本与装配

- [x] 2.1 更新 `package.json`，保持 `npm start` 非 debug，新增 `npm start:debug` 以 debug 环境变量启动编译产物。
- [x] 2.2 在 app 装配根创建 DebugContext，并传入 app、assistant turn runner 和 agent loop runtime 需要的边界。
- [x] 2.3 在 debug 模式启动时显示一个短提示，包含日志路径，并避免新增 footer 布局或 render block 类型。
- [x] 2.4 在退出路径关闭或 flush debug writer，同时保持终端 cleanup 和进程退出语义。

## 3. Debug 事件埋点

- [x] 3.1 记录 app 启动、debug 启用、退出和 resize destructive recovery 事件。
- [x] 3.2 记录用户提交摘要、assistant turn start/end/error/cancelled 事件。
- [x] 3.3 在 provider records 构造完成后记录 provider request 摘要，包括 role 序列、记录数、关键 hash、tool schema hash、interaction mode 和 compaction 边界。
- [x] 3.4 记录 provider usage 摘要；如 adapter 可稳定提供 cache read/create token，则将其作为独立字段写入 debug payload。
- [x] 3.5 记录 tool call start/end 摘要，包括 tool name、call id、risk/approval/result 状态和截断标记。
- [x] 3.6 记录 compaction end 摘要，包括 activeStartIndex、createdAt 和 summary 摘要。

## 4. 测试与验证

- [x] 4.1 增加 debug 环境变量解析、默认 disabled、显式 enabled、显式日志路径和写入失败隔离测试。
- [x] 4.2 增加 JSONL writer 与脱敏/摘要 helper 测试，覆盖 apiKey、headers、长文本和 hash 字段。
- [x] 4.3 增加 CLI/package script 契约测试，验证 `npm start` 不设置 debug，`npm start:debug` 设置 debug 并仍运行 `dist/bin/echo-tui.js`。
- [x] 4.4 增加 app/agent 级测试，验证 debug 模式记录关键事件且不追加 transcript、不改变 provider-visible records。
- [x] 4.5 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \\;`。
