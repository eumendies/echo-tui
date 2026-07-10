## 1. /review workflow 定义

- [x] 1.1 新增 `review-workflow.ts`，定义无参数 `/review`、用户可见描述、`switch_plan_to_normal` 策略和独立 prompt factory
- [x] 1.2 在 prompt 中定义以 `HEAD` 为基线收集 staged、unstaged、untracked 变化，并处理非 Git 工作区和无变更情况
- [x] 1.3 在 prompt 中定义正确性、架构、代码风格的候选发现顺序，以及只审查当前变更、不修改代码的边界
- [x] 1.4 在 prompt 中定义逐项验证门槛，要求确认位置、触发路径、当前变更关联和实际影响，证据不足时丢弃候选项
- [x] 1.5 在 prompt 中定义 P0-P3 严重级别、finding 必填字段、排序规则和无 finding 时的空结果格式

## 2. 内置 workflow 集成

- [x] 2.1 将 `REVIEW_WORKFLOW` 加入现有 `BUILT_IN_AGENT_WORKFLOWS`，保持所有内置 workflows 位于 `SkillInvocationCommandHandler` 之前
- [x] 2.2 更新 `/help` 和 slash command descriptors 相关断言，使 `/review` 出现在帮助、建议和 Tab 补全来源中
- [x] 2.3 确认 `/review` 继续通过现有 `submit_user_message`、workflow metadata 和普通 assistant turn 执行，不新增 runtime 分支

## 3. 自动化测试

- [x] 3.1 添加 `/review` definition 和 prompt 测试，覆盖命令属性、mode 策略、Git 变更范围和禁止修改代码
- [x] 3.2 添加 prompt 质量门槛测试，覆盖正确性优先、逐 finding 验证、低误报、测试失败归因和无问题输出
- [x] 3.3 添加严重级别测试，覆盖 P0-P3 定义、finding 字段、严重级别排序、同级正确性优先和拒绝纯 nit
- [x] 3.4 更新默认 handler 数量与顺序测试，并验证同名 `review` skill 不覆盖内置 `/review`
- [x] 3.5 添加 plan-to-normal 和非 plan 不额外切换测试，确认 mode 在 agent session 创建前完成更新

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`
- [x] 4.2 运行 `npm test`
- [x] 4.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`
- [x] 4.4 手动验证包含 staged、unstaged 和 untracked 文件的工作区能够生成按严重级别排序且带证据的 findings
- [x] 4.5 手动验证无变更、非 Git 工作区、无可确认问题和验证命令无法归因时不会产生推测性 findings
- [x] 4.6 手动验证 plan mode 提交 `/review` 后切换 normal、同名 skill 不覆盖、Esc 可中断且 workflow 不修改项目代码
