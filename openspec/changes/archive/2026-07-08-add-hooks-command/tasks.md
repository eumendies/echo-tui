## 1. Hooks 配置模型和编辑器

- [x] 1.1 扩展 lifecycle hook entry 类型，支持对象格式中的可选 `enabled` 字段，并让 runtime parser 忽略 `enabled: false` entries。
- [x] 1.2 新增 hooks 管理草稿类型，保留 event、entry 顺序、command、timeoutMs、enabled 状态和配置诊断。
- [x] 1.3 实现 hooks 配置草稿读取逻辑，支持 string shorthand 归一化、对象 entry 读取、未知 event 和无效 entry 诊断。
- [x] 1.4 实现 hooks 配置草稿保存逻辑，只替换 `~/.echo/config.json#hooks`，并保留其它 root 配置节点。
- [x] 1.5 为 hooks parser、草稿读取、诊断和保存行为补充单元测试。

## 2. Dispatcher reload 和测试执行入口

- [x] 2.1 扩展 lifecycle hook dispatcher，使其支持在当前进程内更新运行配置，并保证后续 emit 使用新配置。
- [x] 2.2 明确并测试 reload 不影响已入队或正在运行的 hook job。
- [x] 2.3 实现 synthetic payload 构造函数，覆盖 assistant、tool 和 compaction lifecycle events 的测试字段。
- [x] 2.4 实现 hook synthetic test executor，复用 cwd、stdin、env 和 timeout 契约，并捕获 bounded stdout/stderr。
- [x] 2.5 为 synthetic payload、测试成功、非零退出、启动失败、stdout/stderr 截断和 timeout 场景补充单元测试。

## 3. CommandHost hooks 领域能力

- [x] 3.1 在 `CommandHost` 类型中新增 hooks 领域接口，提供读取草稿、保存并 reload、构造 synthetic payload 和测试 entry 的受控能力。
- [x] 3.2 在 command host 实现中接入 hooks 配置编辑器、dispatcher reload 和 synthetic test executor。
- [x] 3.3 确保 `/hooks` handler 不直接访问用户配置文件、完整 AppContext、renderer、terminal 或 dispatcher 内部状态。
- [x] 3.4 为 CommandHost hooks 能力补充保存成功、保存失败、reload 失败和测试结果映射测试。

## 4. /hooks command 状态机和交互

- [x] 4.1 新增 `/hooks` command handler，并在默认 slash command handlers 中注册。
- [x] 4.2 实现 hooks command session 草稿状态，支持 event 列表、entry 列表、编辑态、保存错误态和测试结果态。
- [x] 4.3 实现键盘交互：Up/Down 选择、Enter 进入或打开详情、Esc 取消/返回、Space 启停、添加、编辑、删除、保存和测试。
- [x] 4.4 实现保存校验，阻止空 command 和非法 timeoutMs 写入配置。
- [x] 4.5 确保测试动作不触发真实 assistant turn、tool call、tool approval、tool execution、compaction 或额外 lifecycle hook event。
- [x] 4.6 为 `/hooks` handler 的打开、编辑、取消、保存、保存失败、测试和 slash 匹配行为补充单元测试。

## 5. Hooks command surface 渲染

- [x] 5.1 在 command surface 类型中新增 hooks surface 及其状态字段。
- [x] 5.2 新增 hooks footer renderer，展示事件状态、entry 状态、诊断摘要、保存错误和测试结果。
- [x] 5.3 确保 hooks surface 不展示完整 JSON 配置示例或完整 payload 字段文档，只提供必要的管理信息和简短提示。
- [x] 5.4 展示 hook test 的 exit code、timeout、耗时，以及截断后的 stdout/stderr，并标明真实运行时输出仍被忽略。
- [x] 5.5 为 hooks surface 渲染窗口、空状态、诊断、disabled entry 和测试结果补充渲染测试。

## 6. 文档和验证

- [x] 6.1 更新 README/docs 中 lifecycle hooks 说明，补充 `/hooks` 管理入口、`enabled` 字段、测试语义和 synthetic payload 边界。
- [x] 6.2 更新架构文档，说明 hooks command、CommandHost hooks seam、dispatcher reload 和测试输出隔离。
- [x] 6.3 运行 `npm run typecheck`。
- [x] 6.4 运行 `npm test`。
- [x] 6.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 6.6 手动验证 `/hooks` 打开、管理、保存 reload、测试输出、取消、Esc 行为，以及与普通 assistant turn/hooks runtime 的隔离。
