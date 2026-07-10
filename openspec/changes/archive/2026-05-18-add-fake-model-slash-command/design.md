## Context

当前 slash runtime 已经将命令匹配、命令会话、command surface 渲染和 effect interpreter 分离：`src/commands/resolve-slash-command.js` 负责路由，handler 通过 `command-effects.js` 描述状态变化，`src/app/main.js` 统一解释 effect，renderer 只理解 `commandSurface.kind`。但现有内置命令只有 `/help`，它只覆盖 `info` surface，尚未用真实命令验证 `select` surface 和可交互命令会话的扩展性。

`/model` 适合作为低风险扩展样例：候选模型可写死，不需要接入真实模型服务，也不需要改变 fake agent 行为；它主要验证新增命令是否能在不污染 app 主状态机和 renderer 具体命令认知的前提下完成。

## Goals / Non-Goals

**Goals:**

- 增加一个本地 `/model` slash handler，复用现有 handler/resolver/effect/session 契约。
- 使用现有 `select` command surface 展示写死的模型候选项。
- 支持 Up/Down 移动选中项、Enter 确认、Esc 取消。
- 确认后追加一条本地 assistant transcript，反馈 fake model 选择结果。
- 用测试证明新增命令不进入普通 user message、输入历史或 fake agent 生命周期。

**Non-Goals:**

- 不接入真实模型列表、远程配置或模型服务。
- 不持久化模型选择，也不改变 fake agent 的响应逻辑。
- 不新增 renderer surface kind，不让 renderer 识别 `/model` 这个具体命令名。
- 不引入第三方依赖或 TUI 库。

## Decisions

1. **新增独立 `model-command-handler.js`，而不是把逻辑放进 app。**
   - 理由：保持 app 只负责编排和 effect 解释，新增命令只需要注册 handler。
   - 备选：在 `submitComposer()` 和 `handleEvent()` 中为 `/model` 增加分支；这会回退到重构前的状态机堆积模式，降低扩展性。

2. **模型候选项在 handler 内用常量写死。**
   - 理由：本次是 fake 命令和架构验证，不需要提前设计 provider 或配置层。
   - 备选：从 session config 或外部文件读取；当前没有真实模型来源，反而会扩大范围。

3. **选择状态放在 command session `data.selectedIndex` 和 surface `selectedIndex` 中。**
   - 理由：handler 是选择状态的唯一拥有者，app 只保存会话快照，renderer 只投影 surface。
   - 备选：把 selectedIndex 放进 app 的全局状态；这会让每个新命令都要求 app 新增字段。

4. **Enter 确认后追加 `assistant` role 的本地提示。**
   - 理由：当前 transcript renderer 只稳定支持 `user` 和 `assistant`，使用 `assistant` 可以复用现有块渲染与测试设施。
   - 备选：新增 `system` role；这会引入额外渲染契约，不符合 fake 命令的最小范围。

5. **方向键在候选项中循环移动。**
   - 理由：循环选择对短列表更顺手，handler 内实现简单，不需要 renderer 参与。
   - 备选：到边界后 clamp；行为也可行，但需要给用户额外边界反馈，当前没有必要。

## Risks / Trade-offs

- [Risk] fake 选择结果容易被误解为已改变真实模型。→ Mitigation：文案明确包含 `fake model` 或“仅用于本地演示”，并在 spec 中声明不影响 fake agent 行为。
- [Risk] 新命令若通过 app 分支实现，会破坏刚建立的扩展边界。→ Mitigation：tasks 明确要求通过 handler 注册，app 只在现有 effect interpreter 缺口上做最小补齐。
- [Risk] `select` surface 的渲染已有覆盖，但新命令仍可能遗漏事件流测试。→ Mitigation：增加 handler 单测和 app orchestration 集成测试，覆盖打开、移动、确认、取消。
- [Trade-off] 选择结果不持久化，下一次 `/model` 会回到默认项。→ 这是刻意取舍，保持 fake 命令低风险；真实模型切换可在后续 change 中引入配置与持久化契约。

## Migration Plan

- 新增命令是向后兼容行为；未输入纯 `/model` 的路径不变。
- 若实现有问题，回滚新 handler 注册和相关测试即可恢复现有 `/help`-only slash runtime。

## Open Questions

- 无。候选模型名称、数量和确认提示文案可在实现时选择低风险默认值，只要满足 fake/写死/可测试的契约。
