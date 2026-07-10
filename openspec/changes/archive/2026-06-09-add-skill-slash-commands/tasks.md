## 1. Skill 状态与 manager

- [x] 1.1 新增 skill 状态文件读写模块，支持 `.echo/skills/skills.json` 与 `~/.echo/skills/skills.json` 的 `schemaVersion` 和 `disabled` 列表。
- [x] 1.2 实现状态文件读取失败、JSON 无效和字段无效时的安全降级：不阻断启动，默认全 enabled。
- [x] 1.3 新增 SkillManager 或等价组合层，基于 SkillRegistry 与状态文件提供 `listSkills`、`listEnabledCatalog`、`loadEnabledSkill` 和保存 manage 状态能力。
- [x] 1.4 确保 project skill 覆盖 user 同名 skill 时，启用状态和保存路径绑定到当前 effective skill 的 source root。
- [x] 1.5 为状态读写、默认 enabled、disabled 过滤、同名覆盖状态归属和损坏状态文件降级补充单元测试。

## 2. Provider catalog 与 use_skill 启用状态

- [x] 2.1 调整默认 tool registry/agent setup，使 provider skill catalog 来自 enabled skills，而不是全部 discovered skills。
- [x] 2.2 调整 `use_skill` handler，使 disabled skill 返回 `ok: false` 且不包含完整正文。
- [x] 2.3 确保未知 skill 返回的可用列表只包含 enabled skills。
- [x] 2.4 为 disabled skill 不进 system prompt catalog、状态变化后新 agent run 刷新 catalog、`use_skill` disabled 失败补充测试。

## 3. Command runtime 与 user message 注入

- [x] 3.1 扩展 command handler/start runtime 返回语义，支持 `submit_user_message` 结果并保持既有 slash command 的消费语义兼容。
- [x] 3.2 调整 app 普通提交流程，使 direct skill invocation 返回的 user message 复用现有 begin user turn、spinner、agent callbacks、tool continuation 和错误处理。
- [x] 3.3 支持 slash skill invocation 的 transcript metadata，并扩展使用记录识别逻辑以区分 tool 来源和 slash 来源。
- [x] 3.4 确保 composer history 记录原始 slash 文本，而不是注入后的完整 skill 正文。
- [x] 3.5 为 command runtime 返回语义、slash 注入 user record、普通 agent 触发和 history 行为补充测试。

## 4. /skills 命令与 direct skill invocation

- [x] 4.1 新增 `/skills` command handler，支持 `/skills`、`/skills list` 和 `/skills manage` 路由。
- [x] 4.2 实现 `/skills list` info surface，展示所有有效 discovered skills 的名称、描述、来源和 enabled/disabled 状态。
- [x] 4.3 实现 `/skills manage` checkbox session data，支持 Up/Down 移动、Space 切换草稿、Enter 保存、Esc 取消。
- [x] 4.4 新增 direct skill invocation handler，匹配 `/<skill-name> [arguments...]`，内置 slash command 优先，enabled skill 返回注入 user message。
- [x] 4.5 direct invocation 遇到 disabled skill 时打开提示 surface，不注入 user message，也不把 slash 文本发送给 agent。
- [x] 4.6 将 `/skills` 和 direct skill invocation handler 注册到默认 slash command handlers，并为 list/manage/disabled/direct invocation 补充 command handler 测试。

## 5. Checkbox surface 与 slash suggestion

- [x] 5.1 新增 `CheckboxCommandSurface` 类型及 footer renderer 分支，按 `[x]`/`[ ]` 显示 checked 状态并高亮 selected item。
- [x] 5.2 为 checkbox surface 的渲染、宽度裁剪和 dismissHint 行为补充 renderer 测试。
- [x] 5.3 将 slash suggestion descriptors 改为动态 provider 或等价刷新机制，合并内置命令和当前 enabled skills。
- [x] 5.4 确保 disabled skills 不出现在 slash suggestion 中，但仍出现在 `/skills list/manage` 中。
- [x] 5.5 确保 `/skills manage` 保存后 suggestion 无需重启即可刷新，并补充测试。

## 6. 集成与回归验证

- [x] 6.1 更新 OpenSpec/command/slash 相关测试，确保默认没有 `/skill` 单数命令。
- [x] 6.2 验证 slash 注入的 skill user record 在 OpenAI transcript converter 中按普通 user message 参与 provider input。
- [x] 6.3 验证压缩场景下 slash skill user record 按普通 user record 进入活跃区间或摘要。
- [x] 6.4 运行 `npm run typecheck` 并修复类型错误。
- [x] 6.5 运行 `npm test` 并修复失败测试。
- [x] 6.6 运行 `find bin src test -name '*.js' -exec node --check {} \;` 完成 JS 语法检查。
