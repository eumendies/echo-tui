## 1. Skill 状态与共享类型

- [x] 1.1 扩展 skill state schema、reader 和原子 writer，支持排序后的 `effortOverrides`、合法 `ReasoningEffort` 校验、显式 `none` 及旧状态兼容
- [x] 1.2 扩展 skill list/load、command port 和共享类型，使 effort override 能按当前生效 source root 读取、编辑和保存
- [x] 1.3 增加 skill state 与 manager 测试，覆盖项目/用户 root、旧 schema、无效条目独立降级和 model/effort 状态互不丢失

## 2. `/skills` 交互与渲染

- [x] 2.1 为 skills command session 增加 model/effort 活动字段和 effort 候选，支持 Tab/Shift+Tab 切焦点、Left/Right 循环草稿且两类策略互不重置
- [x] 2.2 扩展 skills surface 快照和 renderer，同时显示模型与 effort 策略、突出活动字段并更新中文按键提示
- [x] 2.3 调整窄终端布局优先级，确保 enabled 状态、skill 名称和活动字段可识别，description 与非活动字段优先裁剪
- [x] 2.4 更新 command 和 footer renderer 测试，覆盖默认焦点、双向循环、保存/取消、模型配置不可用、显式 `none` 及多种终端宽度
- [x] 2.5 为选中行的当前活动字段增加 `‹value›` 边界提示，并将装饰符纳入窄终端宽度预算

## 3. Direct slash turn 覆盖链路

- [x] 3.1 将可选 effort override 从 skill load 和 direct slash invocation 结果贯穿到 command start、assistant turn 与 `AgentSessionInput`
- [x] 3.2 扩展 agent setup 和 LLM 配置解析：先选择有效 model profile，再合并 per-turn effort override，并保持普通 turn 行为不变
- [x] 3.3 增加配置解析、agent setup 和 agent loop 测试，覆盖模型默认、显式 `none`、固定 effort、model/effort 同时覆盖、已删除 profile 回退及 tool continuation 稳定性
- [x] 3.4 验证模型自主 `use_skill` 只加载 instructions/resources，不读取或应用 skill effort override

## 4. 运行状态反馈

- [x] 4.1 扩展 skill override 的 status line 状态解析，展示最终有效 model/effort，并在任一有效 override 生效时标记 `SKILL override`
- [x] 4.2 合并 direct slash turn 的本地 override notice，避免 model 与 effort 同时覆盖时产生重复提示
- [x] 4.3 增加 assistant turn 与 app context 测试，覆盖完成、失败、中断后的全局状态恢复，以及无效 model 但有效 effort 的独立生效

## 5. 回归验证

- [x] 5.1 运行 `npm run typecheck` 并修复全部类型错误
- [x] 5.2 运行 `npm test` 并确认 skill、command、render、agent 与既有回归测试全部通过
- [x] 5.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 完成 JavaScript 语法检查
- [x] 5.4 整理 `/skills` 宽/窄终端、Tab 字段切换、保存/取消和 direct slash 实际 effort 展示的用户手动验证清单
