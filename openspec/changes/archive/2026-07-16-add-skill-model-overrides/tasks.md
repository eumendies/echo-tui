## 1. Skill state 与领域类型

- [x] 1.1 将 skill state schema 扩展为 version 2，增加按 skill name 保存 model profile ID 的 `modelOverrides`，并让 reader 分别归一化 disabled 与模型字段
- [x] 1.2 保持 version 1 状态兼容，补充缺失、损坏和部分无效模型字段不会清除有效 disabled 状态的测试
- [x] 1.3 扩展 skill manager/list item，使模型 override 按当前生效 source root 读取、缓存并与 enabled 状态一起原子保存
- [x] 1.4 补充项目级覆盖、用户级状态、动态当前模型和固定 profile 持久化测试

## 2. /skills 模型策略交互

- [x] 2.1 通过现有 command host 模型 facade 向 `SkillsCommandHandler` 提供最新 model profiles 和全局当前 profile，配置错误时退化为仅动态选项
- [x] 2.2 扩展 skills command data/surface 类型，为每个 skill 投影 model profile ID 和短 label，并保留“当前模型”动态选项
- [x] 2.3 在 `/skills` handler 中实现 Left/Right 循环切换当前 skill 的模型草稿，保持 Up/Down、Space、Enter 和 Esc 现有语义
- [x] 2.4 更新 skills surface 行内布局和操作提示，在窄终端优先保留 enabled、skill name 与模型策略并截断次要描述
- [x] 2.5 补充动态与固定当前 profile 区分、左右循环、disabled skill 预设、统一保存、取消和模型配置不可用的 handler/render 测试

## 3. 显式 slash invocation 单 turn 覆盖

- [x] 3.1 为 LLM 配置解析增加可选 model profile ID override；有效 ID 选择完整 profile，无效或已删除 ID 回退全局当前 profile
- [x] 3.2 在 direct skill invocation 解析中读取当前 skill override，并通过 typed `CommandStartResult`、assistant turn input 和 `AgentSessionInput` 传递，不依赖 transcript metadata 驱动执行
- [x] 3.3 更新 agent loop 初始化，使 provider、model、reasoning、context window、registry、usage 和 tool continuation 使用同一份覆盖后配置，且不写入 `llm.selectedModel`
- [x] 3.4 补充显式 slash 固定模型、动态当前模型、陈旧 profile 回退、完成/失败/中断后普通 turn 恢复当前模型的测试
- [x] 3.5 补充普通 turn 与 slash override turn 中自主 `use_skill` 均不按被加载 skill 再切换模型的回归测试

## 4. 文档与验证

- [x] 4.1 更新 README 和 TUI 架构文档，说明 `/skills` Left/Right 模型策略、动态当前模型和显式 slash 单 turn 覆盖边界
- [x] 4.2 运行 `npm run typecheck`
- [x] 4.3 运行 `npm test`
- [x] 4.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.5 手动验证 `/skills` 左右循环与窄终端布局、Enter/Esc 草稿语义、不同 provider profile 的显式 slash invocation、陈旧 profile 回退，以及自主 `use_skill` 保持当前运行模型
