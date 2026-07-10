## 1. AGENTS 发现与读取

- [x] 1.1 新增 AGENTS 指令加载模块，定义全局路径、项目 `AGENTS.md` 文件模型、大小预算和读取结果类型。
- [x] 1.2 实现项目根查找：从 `cwd` 向上寻找最近 `.git` 或项目 `.echo` marker，支持 `.git` 文件/目录，并忽略用户 home 下的全局 `~/.echo`。
- [x] 1.3 实现项目 AGENTS 路径收集：找到项目根时按项目根到 `cwd` 的路径链路收集 `AGENTS.md`；未找到 marker 时只尝试 `cwd/AGENTS.md`。
- [x] 1.4 实现全局 AGENTS 读取：固定读取 `~/.echo/AGENTS.md`，并确保它不参与项目根判定。
- [x] 1.5 对缺失、不可读、非普通文件和读取失败场景安全跳过，不阻断 agent run。
- [x] 1.6 对单文件和总 AGENTS 内容应用大小预算，截断时保留 `truncated` 或等价提示。

## 2. System Prompt 集成

- [x] 2.1 扩展 `createBuiltInSystemPrompt()` 上下文，使其能接收 AGENTS 指令来源和内容。
- [x] 2.2 在 system prompt 中新增 AGENTS section，按全局、项目根、子目录到 `cwd` 的顺序渲染，并标明来源。
- [x] 2.3 在 AGENTS section 中明确优先级：内置运行时约束、tool 安全策略和当前交互模式高于 AGENTS；更具体项目路径高于项目根；项目高于全局。
- [x] 2.4 保持无 AGENTS 时的原请求形态，不生成空 section。

## 3. Runtime 接线

- [x] 3.1 在 `agent-loop-runtime` 每次 agent run 初始化或构造 provider records 前加载当前 `cwd` 的 AGENTS 指令。
- [x] 3.2 将 AGENTS 指令传入 `buildProviderRecords()`，并确保 tool continuation turn 继续使用同一组 runtime AGENTS 指令。
- [x] 3.3 为 runtime dependencies 增加必要测试 seam，允许测试注入 AGENTS loader 或文件系统行为。
- [x] 3.4 确认 OpenAI provider agent 仍只转换传入 records，不自行读取 AGENTS 或生成额外 system prompt。

## 4. 测试与验证

- [x] 4.1 添加 AGENTS loader 单元测试，覆盖 `.git` 根、`.git` 文件、项目 `.echo` 根、忽略 home `~/.echo`、无 marker 只读 `cwd/AGENTS.md`。
- [x] 4.2 添加读取顺序测试，覆盖全局 AGENTS、项目根 AGENTS、子目录 scoped AGENTS 的渲染顺序和来源标签。
- [x] 4.3 添加降级测试，覆盖缺失、不可读、非普通文件、超出大小预算和截断提示。
- [x] 4.4 更新 agent loop/system prompt 测试，验证 AGENTS 指令进入第一条 system record、不进入 transcript callbacks、plan mode 和 skill catalog 语义保留。
- [x] 4.5 运行 `npm run typecheck`。
- [x] 4.6 运行 `npm test`。
- [x] 4.7 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
