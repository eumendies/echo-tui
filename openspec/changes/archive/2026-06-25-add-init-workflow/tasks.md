## 1. 内置 workflow 基础结构

- [x] 1.1 新增 `AgentWorkflowDefinition`、参数策略和 mode 策略类型，保持定义只覆盖命令元数据、匹配需求和 prompt factory
- [x] 1.2 实现通用 `AgentWorkflowCommandHandler`，支持无参数/可选参数匹配、原始命令显示文本、独立 workflow metadata 和 `submit_user_message`
- [x] 1.3 实现 workflow handler 的 plan-to-normal 策略，通过现有 `CommandHost.mode` 切换且不在完成后恢复
- [x] 1.4 新增内置 workflow 注册列表和 handler factory，避免为未来 workflow 复制注册与转换逻辑

## 2. /init workflow

- [x] 2.1 新增 `/init` workflow definition 和独立 prompt factory，声明无参数匹配及 `switch_plan_to_normal` 策略
- [x] 2.2 在 prompt 中约束项目根识别、仓库证据收集、禁止猜测和目标 `AGENTS.md` 路径确认
- [x] 2.3 在 prompt 中定义缺失文件时使用 `apply_patch` 新建、沿用审批和 best effort undo，并说明下一轮请求才加载新指令
- [x] 2.4 在 prompt 中定义已有文件时只输出带优先级、证据和建议文案的改进项，禁止自动调用 `apply_patch` 修改文件

## 3. Slash command 集成

- [x] 3.1 在默认 slash command handlers 中注册内置 workflow handlers，并确保位于 `SkillInvocationCommandHandler` 之前
- [x] 3.2 让 slash suggestion 自动包含 `/init` 描述，并更新 `/help` 或相关用户文档中的命令列表
- [x] 3.3 确认 app 提交流程继续使用现有 user record、agent turn、tool approval 和 undo 路径，不新增 workflow 专用 runtime 分支

## 4. 自动化测试

- [x] 4.1 添加通用 workflow handler 测试，覆盖无参数和可选参数匹配、display/history text、metadata 与普通提交结果
- [x] 4.2 添加 mode 策略测试，覆盖 plan 切换 normal、非 plan 不切换以及切换发生在 agent session 读取之前
- [x] 4.3 添加默认 handler 顺序和同名 `init` skill 不覆盖内置 `/init` 的测试
- [x] 4.4 添加 `/init` prompt 测试，覆盖缺失文件生成、已有文件只评审、仓库证据约束、`apply_patch` 边界和下一轮生效说明
- [x] 4.5 更新 slash suggestion、帮助文案和现有 handler 数量/顺序断言

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`
- [x] 5.2 运行 `npm test`
- [x] 5.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`
- [x] 5.4 手动验证 normal mode 下 `/init` 的已有/缺失 `AGENTS.md` 分支、apply-patch 审批与可用时的 `/undo`
- [x] 5.5 手动验证 plan mode 提交 `/init` 后切换为 normal、slash suggestion/Tab 补全、Esc 中断和后续消息加载新 `AGENTS.md`
