## Context

当前 slash 子系统是沿着“先能工作”逐步长出来的：提交路径在 `src/app/main.js` 中先调用 `parseSlashCommand()`，再调用 `runSlashCommand()`；命令模块直接返回固定结果；overlay 活跃时的事件消费也主要由 `src/app/main.js` 内部分支负责。这个结构对单个 `/help` 来说是足够的，但一旦继续增加 `/model`、`/status`、`/clear` 这类结果形态不同的命令，就会把复杂度同时推到三处：slash 路由判断、overlay 内事件分发、命令结果如何更新 footer / transcript / session 配置。

这次重构的目标不是一次性实现所有新命令，而是给现有 slash 子系统补上一个稳定运行时：统一路由入口、统一 handler 接口、统一 command session、统一 effect interpreter。这样后续扩展新命令时，不需要继续把命令特判塞回 `src/app/main.js`。

当前已有三个重要约束：

- `key-parser` 继续保持无跨 chunk 缓冲，不顺手扩大输入模型范围。
- transcript 仍是 append-only，普通交互仍优先走 footer-only redraw；命令如果要影响 transcript，也必须通过 app 统一编排。
- 第一版 handler 还不支持参数，但路由方案要允许未来由各个 handler 自行决定 `match()` 逻辑，因此不能把 slash 路由再次退化成 `main.js` 中的一组硬编码 `if/else`。

## Goals / Non-Goals

**Goals:**
- 把 slash 路由、命令处理和 effect 执行收敛成清晰的运行时边界，降低 `src/app/main.js` 的命令特判负担。
- 采用方案 B：slash 路由器按顺序询问各个 handler 是否命中；handler 自己决定匹配规则，当前仍可使用全文精确匹配。
- 引入显式的 command session，统一承载 info/select/confirm 等交互式命令的活跃状态与事件处理。
- 引入 effect interpreter，让命令通过结构化 effect 请求“打开 session / 追加 transcript / 更新配置”等动作，而不是直接修改 app 状态。
- 把现有 `/help` 迁移到新运行时下，同时保持外部行为不回退。

**Non-Goals:**
- 不在这次 change 中实现新的产品命令（如 `/model`、`/status`）的完整最终能力。
- 不引入插件系统、动态加载命令、第三方依赖或跨文件注册魔法。
- 不重做 footer 全局布局，也不在本次解决所有 transcript role 设计问题。
- 不改变现有 raw input、history、fake agent 生命周期和 destructive replay 的基本语义。

## Decisions

### Decision: 解析层与注册层合并为统一的 slash resolver
当前项目不需要把“纯语法解析”与“注册表查找”拆成两层。更合适的做法是提供一个统一入口，例如 `resolveSlashCommand(text)`：

- 输入一段已提交文本；
- 依次询问各个 handler 是否命中；
- 若命中，则返回 `{ handler, invocation }`；
- 若没有任何 handler 命中，则返回 `null`，并回退为普通 user message 提交。

这保留了方案 B 的核心：是否命中由 handler 自己决定，而不是先在中心化 parser 中硬编码命令规则。当前 handler 仍使用全文精确匹配即可；未来若要支持参数，可以把更复杂的匹配逻辑留在各 handler 的 `match()` 中。

备选方案一：继续使用中心化 `parseSlashCommand()` + `registry.get(name)`。放弃原因是当前并不存在独立复杂语法，强拆成两层只会增加样板代码。

备选方案二：把命中判断直接写回 `src/app/main.js`。放弃原因是会再次把 slash 扩展压力推回 orchestration 层。

### Decision: slash 命令统一通过 handler 接口暴露能力
每个命令应实现统一的 handler 协议，至少包含两类入口：

- `match(text)`：判断当前提交文本是否命中该命令，并在命中时返回 invocation 数据；
- `start(invocation, context)`：在用户提交该命令时启动命令，并返回一组 effect；
- 对交互式命令可选实现 `handleEvent(session, event, context)`：当该命令的 session 处于活跃状态时消费后续按键，并继续返回 effect。

这样 `/help`、未来的 `/model` 和 `/status` 共享同一套运行时，而 app 层无需关心不同命令的内部逻辑。

备选方案：把“无交互命令”和“有交互命令”分成两套不兼容接口。放弃原因是 app 层最终仍需要统一调度命令结果，拆成两套协议只会增加分支。

### Decision: app 层持有显式的 command session，而不是把交互式命令都压缩成 overlay
当前只有 `/help` 时，用单一 `overlay` 状态还能成立；但未来一旦加入选择型和确认型命令，就需要一个更稳定的抽象，例如：

- `activeCommandSession: null | { commandName, surface, data }`

其中：

- `surface` 表示给 renderer 的视图模型，例如 `info`、`select`、`confirm`；
- `data` 表示 handler 内部状态，例如当前选中项索引、候选列表、运行时上下文。

app 层只负责判断“当前是否有活跃 command session”；具体事件如何改变 session，由对应 handler 处理。

备选方案：继续只保留一个自由形态的 `overlay` 对象。放弃原因是命令变多后，renderer 和 app 都会开始读取命令私有字段，边界会很快变脆。

### Decision: handler 不直接改 app 状态，而是返回结构化 effect 由 app 统一解释执行
这是本次最核心的运行时边界。命令 handler 不应直接调用 renderer、直接 push transcript 或直接 mutate app 状态，而应只返回结构化 effect，例如：

- 打开 / 更新 / 关闭 command session
- 追加 transcript record
- 更新 session 级配置
- 重置 composer 或清理历史

app 层提供统一的 `applyEffects()` 执行这些 effect，并在 effect 执行完后走现有渲染路径。这样可以把“命令决定做什么”和“应用如何实现这些动作”明确分离。

备选方案：让 handler 直接持有 app 上下文并原地修改。放弃原因是短期写起来快，但会让 slash 子系统再次变成一组分散副作用。

### Decision: renderer 只认识有限的 command surface 类型，而不是理解具体命令名
slash 运行时不是要让 renderer 认识 `/help`、`/model`、`/status` 等命令名，而是让 renderer 认识少数几种稳定 UI surface：

- `info`：静态说明，例如 `/help`
- `select`：可选择列表，例如未来的 `/model`
- `confirm`：确认面板，例如未来的 `/clear`

命令 handler 负责把自己的 session 状态投影成这些 surface。renderer 只按 surface kind 渲染，不读取命令业务语义。

备选方案：每个命令定义自己私有的 overlay 结构，并让 footer renderer 为每个命令分支。放弃原因是 renderer 会逐渐被命令细节侵蚀。

### Decision: `/help` 作为第一条命令迁移到新运行时，但行为保持不变
为了控制风险，本次重构不同时引入新的产品能力，而是先把现有 `/help` 迁移到新运行时：

- 仍然只匹配纯 `/help`
- 仍然在 footer/composer 区域显示 info surface
- 仍然由 Esc 退出
- 仍然不进入历史、不走 agent、不追加 transcript

这样既能验证新运行时骨架有效，也不会把行为变化和架构重构混在一起。

## Risks / Trade-offs

- [Risk] 引入 handler / session / effect 三层后，初看上去比单一 `/help` 特判更抽象 → Mitigation：保持接口最小化，只为当前真实问题服务，不上插件系统和动态装配。
- [Risk] command session 与现有 history / pending / composer 状态同时存在，可能让 app 状态机交织 → Mitigation：明确优先级为“active command session > 普通输入态”，并要求 session 内事件只通过 handler 返回 effect 更新。
- [Risk] surface kind 抽象过早，可能和真实命令需求不完全吻合 → Mitigation：第一版只稳定 `info/select/confirm` 三类，后续若出现新模式再扩展，而不是一开始设计过大枚举。
- [Risk] effect 类型若定义过散，仍可能把细节泄漏到各处 → Mitigation：把 effect 类型限制在少数高层动作，避免暴露底层 renderer 或 terminal 操作。

## Migration Plan

1. 引入统一的 slash resolver，按 handler 顺序做 `match()` 并返回 resolved command 或 `null`。
2. 为 slash handler 定义统一接口，并将现有 `/help` 实现迁移为 handler。
3. 在 app 层引入 `activeCommandSession` 与 `applyEffects()`，让 slash 提交和 session 活跃时的按键都走统一运行时。
4. 调整 footer/render 状态输入，使 renderer 读取 surface kind，而不是读取某个命令的私有结构。
5. 更新测试，锁定 resolver、handler、effect interpreter 和 `/help` 行为不回退；如有必要，再以新的 change 接入 `/model`、`/status` 等具体命令。

## Open Questions

- 是否要在这次 change 中顺手为 transcript 增加 `system` role，以便后续 `/status` 直接输出到历史区域？当前建议是不在本次一并落地，只在 design 中预留 effect 能力与 renderer 扩展方向。
