## 1. 存储层：index 标题改为可继承

- [x] 1.1 将 `TranscriptSessionIndexState.title` 改为可选，并在注释中说明"省略表示保持现有标题"
- [x] 1.2 修改 `listSessionSummaries`，指纹失配时使用 `indexed?.title ?? createSessionTitle(...)` 保留已有标题
- [x] 1.3 修改 `updateSessionIndex`，用 `state.title ?? existing?.title ?? '未命名对话'` 保证写入值非空
- [x] 1.4 补充存储层测试：指纹变化后标题保持、消息数量刷新、index 缺失时回退派生、空标题不产生无效条目

## 2. 配置层：titleModelProfileId

- [x] 2.1 在 `AppSettings` 新增可选字段 `titleGenerationModelProfileId`
- [x] 2.2 在 `normalizeAppSettings` 中读取 `sessions.titleModelProfileId`
- [x] 2.3 在 `validateAppSettingsDraft` 中校验其为非空字符串且命中已保存 profile
- [x] 2.4 在 `applyAppSettingsDraft` 中写入 `sessions` 节点并保留同级字段
- [x] 2.5 在 `/config` 常规 Tab 增加"标题生成模型"行，允许未配置状态与 profile 循环选择
- [x] 2.6 补充配置测试：默认未配置、保存有效引用、失效引用拒绝保存、同级字段保留
- [x] 2.7 新增 `titleGenerationEnabled` 开关，配置行按“不生成 → 跟随当前模型 → profile”顺序循环，关闭时保留原 profile 引用

## 3. 标题生成器

- [x] 3.1 新增独立生成器模块，导出 `generateSessionTitle`
- [x] 3.2 实现模型解析：配置存在时严格解析 profile，缺失时使用当前模型并覆盖 `low` effort
- [x] 3.3 用 `createConfiguredAgent` 构建无 registry 的 provider，发起 system + user 两条记录的 `runTurn`
- [x] 3.4 实现独立 abort scope 与超时，失败返回 `null`
- [x] 3.5 实现标题规范化：去引号、压空白、去尾标点、按 code point 截断 60 字符
- [x] 3.6 补充测试：规范化各分支、配置失效不回退、无工具请求、超时与空输出返回 `null`

## 4. 触发接入

- [x] 4.1 在 `runAssistantTurn` 中识别"主 transcript 会话创建后的首条用户记录"
- [x] 4.2 条件满足时 fire-and-forget 启动生成，不 `await`，不阻塞首个流式响应
- [x] 4.3 生成成功后通过 transcript context 把标题写入 index 并触发 footer 重绘
- [x] 4.4 生成失败、超时或无效输出时不修改任何持久化状态，也不产生可见错误提示
- [x] 4.5 排除 `/btw`、subagent 与 headless 路径
- [x] 4.6 补充测试：新会话触发一次、后续消息不重复、恢复会话不触发、`/fork` 后不触发

## 5. 展示接入

- [x] 5.1 将 `/resume` 列表项改为"更新时间 · 会话标题"，与 `/reference` 对齐
- [x] 5.2 在 `StatusLineState` 新增 `sessionTitle`，由 transcript context 提供
- [x] 5.3 在 `createLeftStatusSegments` 的 model/effort 之后、工具标记与项目目录之前插入标题分段，并按固定预算截断
- [x] 5.4 确认命令 surface、模型调节与 shell 模式下不额外渲染标题
- [x] 5.5 补充测试：resume 标签格式、窄宽度裁剪顺序、切换会话后 statusline 刷新

## 6. `/fork` 继承标题

- [x] 6.1 `forkSession` 在更新新 session index 时显式传入源会话标题
- [x] 6.2 确认继承不触发新的标题生成请求
- [x] 6.3 补充测试：继承派生标题、继承生成标题、分叉失败不写标题

## 7. 验证

- [x] 7.1 运行 `npm run typecheck`
- [x] 7.2 运行 `npm test`
- [x] 7.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [ ] 7.4 手工验证：新会话首条消息后标题替换、`/resume` 列表显示标题、statusline 展示与窄终端裁剪、`/fork` 继承、生成失败静默降级
- [x] 7.5 手工验证 headless：`echo-tui --once "..."` 不发起标题生成
- [x] 7.6 Review 修复：loadSession/undo 保留 generated、applyAppSettingsDraft 删除旧引用、关闭态容忍失效引用、非贪婪 JSON、grapheme 统一截断、迟到标题主动重绘
- [x] 7.7 生成期间 statusline 展示「未命名对话」占位，生成失败后才回落到派生标题，消除派生→生成的跳变
- [x] 7.8 会话浏览器左栏只显示标题，选中项更新时间与消息数移到右栏标题，窄终端不挤占标题列
