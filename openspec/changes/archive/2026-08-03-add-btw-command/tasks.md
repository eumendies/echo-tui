## 1. Agent readonly 执行边界

- [x] 1.1 在 agent session/run state 类型中增加默认兼容的 per-run tool policy，并为 BTW conversation metadata 定义仅供本地执行、调试和渲染使用的字段，确保 built-in system prompt 构造不读取这些字段
- [x] 1.2 抽取或复用 readonly bash inspection 分类逻辑，实现文件读取、glob/grep、网页读取/搜索、skill 和临时 todo 的显式 allowlist，以及写工具、非只读 bash、MCP、ask-user 和未知工具的 fail-closed 结果
- [x] 1.3 在 agent loop 的 approval、user-question callback 和普通 executor 之前应用 readonly policy，保证拒绝结果保留 call id/name 且不会触发授权、change recorder 或交互等待
- [x] 1.4 添加 agent/tool policy 测试，覆盖默认行为不变、允许只读调用、拒绝各类副作用调用，以及相同运行配置下 system prompt、tool definitions 和 prompt cache key 不因 BTW 改变

## 2. BTW 临时会话状态与 side runner

- [x] 2.1 新增 BTW conversation context/controller，维护冻结父 records/compaction、side records、独立 composer/pending/working/todo、conversation/turn identity 和 abort controller，并避免依赖 transcript store 与主 change history
- [x] 2.2 实现首条 BTW user message 的 provider-facing boundary 包装和原始 `displayText` 投影，构造不携带主 todo、change history 或 `sessionJournalPath` 的 side agent session
- [x] 2.3 新增 side turn runner，把 thinking、streaming、reasoning、provider-private records、tool pair、todo、compaction、complete/error 回调写入临时状态，并在每个异步入口校验 conversation/turn identity
- [x] 2.4 实现 BTW 多轮提交、单槽 pending 自动 claim、active turn abort 和整段会话丢弃，确保退出后的 callback/catch/finally 不再修改状态或触发渲染

## 3. `/btw` 命令与输入路由

- [x] 3.1 为 `CommandHost` 增加受控 BTW facade，并定义 BTW command session/surface 类型，使 handler 无需访问 AppContext、renderer 或裸 agent
- [x] 3.2 实现并注册 `BtwCommandHandler`，支持 `/btw` 与 `/btw <问题>`、响应期立即启动、单实例限制，以及 suggestion/help 描述
- [x] 3.3 将 BTW composer 接入现有文本编辑键位、Ctrl+J、Enter 和 Esc 路由；BTW 活跃时由其消费包括 slash 前缀在内的输入，不启动嵌套 command session
- [x] 3.4 保持 user-question、tool-approval、file-picker 和本地 modal 的既有输入优先级，验证 modal Esc 只关闭当前上层交互而不直接关闭 BTW 或中断主 turn

## 4. 主/BTW 可见投影与终端渲染

- [x] 4.1 增加紧凑 BTW banner、BTW composer/footer 状态和 MAIN activity 摘要渲染，展示临时、readonly 与 Esc 返回提示并遵守 footer 高度边界
- [x] 4.2 在 app 编排层增加 main/BTW 可见投影选择和来源明确的 append 路由：side 稳定 records 仅绘制到 BTW，后台主 records 继续持久化但在 BTW 期间不 append
- [x] 4.3 进入和退出 BTW 时调用现有 destructive renderer 分别重放 side-only 与最新主 records；resize recovery 根据 active view 重放正确 banner、records 和 footer，且不启用 alternate screen
- [x] 4.4 接入 side streaming/footer-only redraw 与稳定 record append 路径，确保 token 不触发 destructive repaint，退出后恢复 BTW 期间主会话新增的全部内容与最新 pending 状态

## 5. 自动化测试

- [x] 5.1 添加 BTW context/runner 测试，覆盖父快照冻结、主 todo/journal 排除、boundary 可见文本、多轮上下文、临时 compaction/todo 和不写主持久化状态
- [x] 5.2 添加 BTW lifecycle 测试，覆盖空参数/带参数启动、side pending、Esc abort、迟到 callback 隔离、后台主 turn 不被中断和退出恢复
- [x] 5.3 添加 command/input 测试，覆盖注册与帮助、响应期 suggestions、slash 前缀作为 side 文本、单 command session 和高优先级 modal 路由
- [x] 5.4 添加 renderer/controller 测试，覆盖 enter/exit/resize destructive 投影、BTW append/footer 更新、后台主 record 隐藏与恢复，以及有界 MAIN activity 状态

## 6. 验证

- [x] 6.1 依次运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`，修复所有回归
- [x] 6.2 交付用户手动验证 BTW TUI：主 streaming/tool 期间进入、BTW 多轮与只读工具、Ctrl+J/Enter、modal 覆盖、Esc 中断恢复、resize、主后台内容补回及 Ctrl+C/Ctrl+D 清理
