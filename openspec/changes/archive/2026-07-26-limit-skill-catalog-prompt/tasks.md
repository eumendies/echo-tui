## 1. Skill catalog 预算投影

- [x] 1.1 在 skill catalog prompt 模块定义 projection 结果与默认预算常量，使用现有 token estimator 计算完整 prompt、固定开销和目标预算。
- [x] 1.2 实现统一动态 description token cap 搜索，使预算内短描述保持完整、超限长描述按首 70%/尾 30% 与省略标记安全截断。
- [x] 1.3 实现固定 header 与全部 skill 名称超过预算时的 names-only 退化，确保不删除、重命名或截断 skill name。
- [x] 1.4 补充 projection 纯函数测试，覆盖 full、truncated、names-only、预算边界、短描述保留、Unicode 和确定性输出。

## 2. 配置与运行时接入

- [x] 2.1 扩展 AppSettings 默认值、严格校验、容错读取和原子保存，在 `skills.catalogContextRatio` 使用默认 0.02 与 0.01 至 0.10 范围。
- [x] 2.2 扩展 AgentSessionInput 和 AppContext session snapshot，使 TUI 单轮固定使用启动时的 Skill catalog 比例，并让 headless 路径读取同一归一化设置。
- [x] 2.3 在 agent loop run state 初始化时按当前 context window 创建一次 catalog projection，并让所有 provider continuation 复用该 projection。
- [x] 2.4 将 projection 后的实际 estimated tokens 接入 context usage Skills 分类与非敏感 debug 摘要，保持完整 registry metadata 不变。
- [x] 2.5 扩展 app settings 刷新分类，在 Skill catalog 比例变化时清理旧 context usage，但不触发 transcript 重绘或改变 active run。

## 3. `/config` 常规设置交互

- [x] 3.1 在“常规”Tab 增加“技能列表上下文占比上限”百分比行，并调整列表行数、选择索引和保存 action 索引。
- [x] 3.2 支持通过 Left/Right 在 1% 至 10% 范围内按 1% 调节草稿，显式保存前不修改运行时配置。
- [x] 3.3 更新配置 surface、handler、CommandHost/AppContext 测试，覆盖显示、导航、dirty 状态、保存、错误和保存后下一轮生效。

## 4. 集成测试与验证

- [x] 4.1 更新 system prompt 和 agent loop 测试，覆盖预算内 prompt 不变、超预算截断、同一 run continuation 稳定及 TUI/headless 配置一致性。
- [x] 4.2 更新 context usage 测试，确认 Skills 分类使用投影后 token 且校准后的分类总和保持等于 provider used tokens。
- [x] 4.3 运行 `npm run typecheck`。
- [x] 4.4 运行 `npm test`。
- [x] 4.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 4.6 运行 `npx openspec validate limit-skill-catalog-prompt --strict` 和 `git diff --check`。
