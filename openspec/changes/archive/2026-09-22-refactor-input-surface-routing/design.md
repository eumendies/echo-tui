## Context

当前实现中，`InputEventController` 同时持有用户问题、工具审批、文件选择、自动更新、subagent view、command runtime 和本地 surface 等具体 port，并在事件处理函数中维护优先级。`main.ts` 又以另一组条件选择要渲染的 modal `CommandSurface`。`FooterPointerController` 除了 SGR 鼠标、CPR 校准、frame version 与坐标命中外，还直接识别 `choice`、file picker、slash suggestion 及三个具体 context。

这些实现已经保证既有交互，但新增 footer surface 或给既有 command choice 接入鼠标时，开发者必须同时理解并更新多个不相邻的选择链。项目必须继续采用 ANSI/raw-mode 渲染，保留 headless 路径、transcript 与 owner 生命周期；subagent view 和 BTW 是可见投影 owner，不等同于普通 footer modal。

## Goals / Non-Goals

**Goals:**

- 为可消费输入的 footer 交互建立小型 `InputConsumer` 契约，并以计算结果而非可变全局 `activeUi` 状态确定当前有效消费者。
- 使一份有序注册表成为键盘优先级与高优先级 footer surface 选择的事实来源。
- 使 pointer 层仅处理终端协议和临时布局，把已命中的语义 target 转交给当前匹配的 pointer consumer。
- 在不改变任何既有键盘、Esc、Enter、异步 command、CPR、鼠标或重绘语义的前提下，为新增 surface 留出注册扩展点。

**Non-Goals:**

- 不要求所有 context 继承基类，也不迁移它们的状态、生命周期或 render callback。
- 不重做 BTW/subagent view 的 owner、投影、turn identity 或 transcript 逻辑；它们只通过 adapter 参与既有输入优先级。
- 不为所有 command surface 自动启用鼠标；某个 surface 只有显式提供 pointer consumer 时才可接收鼠标。
- 不改变 command handler、provider、MCP、会话持久化、CLI/headless 或公共配置行为。

## Decisions

### 以接口和 adapter 表达能力，而非抽象继承树

定义结构化的 `InputConsumer` 契约：消费者至少具有稳定 ID、活跃判定和事件处理能力；可选能力包括产生 footer `CommandSurface`、标识全局 overlay/主 owner 可见边界，以及处理结构化鼠标 target。处理结果必须能够表达“已消费”与“继续落到下一层”，并允许 command 路径返回异步工作。

现有 `UserQuestionContext`、`ToolApprovalContext`、`FilePickerContext`、`AutoUpdateController`、`CommandRuntime` 与其他状态机通过 `createActiveInputRouting()` 包装为 adapter。该组装函数与通用 resolver 同处 `active-input-resolver.ts`，使 `main.ts` 只传入生产依赖而不承载长责任链；`ActiveInputResolver` 类本身仍不持有业务状态。adapter 保留既有 `onChange`、`render()`、关闭后 pending-message dispatch 和错误传播职责，避免为测试或统一性引入额外的生产回调。

替代方案是所有类继承 `InputConsumerBase`。不采用该方案：这些对象的状态来源、异步生命周期与 pointer 能力不同，基类会积累 `getSurface?`、`handlePointer?`、owner 等可选钩子，反而把不相关的领域耦合在一起。

### resolver 按注册顺序实时计算有效消费者

`ActiveInputResolver` 接收有序 consumer 注册表，在每次路由或渲染时查询 `isActive()`，返回第一个活跃项；它不保存可变的“当前 UI”字段。这样高优先级请求异步出现或关闭后，低优先级状态会自动恢复，无需手工维护压栈/出栈。

初始注册顺序必须等价于现有行为：用户问题、工具审批、文件选择、自动更新、subagent view、command session、会话引用准备、本地 info surface、model tuning，最后才是普通 composer 相关 fallback。普通 composer 仍由 `InputEventController` 的稳定 fallback 处理；slash suggestion 作为该层的可选低优先级 interceptor，可在补全后选择继续本次 Submit，而不是把 Enter 一律吞掉。Ctrl+O 打开未激活窗口、打开 model tuning 等“激活新状态”的快捷键仍属于 fallback/生命周期动作，不伪装成已激活 surface。

这项决策统一的是**当前有效输入焦点**，而非把所有运行状态设为互斥。subagent view、BTW、后台主 turn 与高优先级 modal 仍可并存；resolver 只决定当前事件首先交给谁。

### 将 footer 投影从同一解析结果派生，同时保留 owner 轴

`main.ts` 在构造 render state 时读取 resolver 的当前结果，而不是再写一套 user question/tool approval/file picker/auto update 的 OR 链。消费者可选地提供 `CommandSurface` 投影及其可见边界：用户问题、工具审批、文件选择和自动更新作为全局 overlay；主会话 command 与本地 info surface 仍只在 main owner 可见；没有 `CommandSurface` 的消费者继续由现有 AppContext、subagent view 或 BTW 投影提供 footer。

`currentOwner()` 保留独立职责，继续解析 `view > btw > main` 的 body/streaming 投影。高优先级 overlay 可覆盖该 owner；解除 overlay 后恢复原 owner。此边界避免把“谁拥有可见 transcript”错误建模为“谁消费键盘”。

### pointer controller 只处理协议、坐标与安全校验

`FooterPointerController` 保留鼠标模式启停、SGR/CPR 事件消费、单在途校准、超时、版本校验、坐标换算和 hover 去重。命中区域增加稳定的 `interactionId`，由当前 render 的交互消费者提供；布局类别（如 `choice` 或 `file_picker`）继续只服务 renderer 布局。

pointer controller 在启用鼠标、接受 hover 或 activate 前，必须同时验证 frame version、CPR calibration、hit region 的 `interactionId` 与 resolver 当前 pointer consumer ID。通过验证后才调用该 consumer 的 pointer handler。它不得 import 或分支判断用户问题、工具审批、文件选择或 AppContext 的业务方法。没有 pointer handler 或没有匹配 identity 的 surface 保持纯键盘交互，且不启用鼠标报告。

替代方案是在 `FooterPointerController` 内维护一个按 `target.kind` 分派的全局 handler 表。该方案仍要求 pointer 层知道全部业务 target 和当前 context，无法解决新增 command choice 时的扩展问题，因此不采用。

### 保持 InputEventController 的协议与异步边界

`InputEventController` 继续拥有跨 chunk key parser、最近输入时间戳、CPR/mouse 协议事件的优先消费，以及一个 chunk 内收集并等待既有异步 command/submit 工作的边界。它通过 resolver 转发普通语义事件，而不是为每个业务 context 增加字段和 if 链。`EXIT` 放行、subagent view 的特殊返回、command session 关闭后的 queued command dispatch、Esc 的 pending/reference/shell/turn 顺序必须通过相应 adapter 或 fallback 原样保留。

## Risks / Trade-offs

- [将 slash suggestion 当作独占 consumer 会吞掉既有 Enter 提交] → 处理结果明确支持继续路由；为 suggestion completion 后 Submit 与 Tab completion 编写回归测试。
- [frame 已更新或高优先级 surface 切换时鼠标命中旧目标] → 同时校验 snapshot version、CPR calibration 和 `interactionId`，任一不匹配即忽略。
- [将 visible owner 与输入焦点合并会破坏 BTW/subagent modal 覆盖] → owner 保持独立解析；只从 input consumer 派生 footer overlay/主会话 surface。
- [adapter 改变异步 promise 时机，造成 chunk 内交错] → 保持当前同步遍历、收集 Promise 并 `Promise.all` 的模型，不引入串行队列。
- [一次迁移遗漏低优先级 fallback] → 用现有优先级表驱动 resolver 注册与控制器级测试，覆盖 Esc、Exit、Ctrl+O、pending command 和普通 composer。

## Migration Plan

1. 新增 consumer/result/resolver 的类型与纯解析测试，先以当前优先级注册测试 port。
2. 在 `active-input-resolver.ts` 的 `createActiveInputRouting()` 为现有 modal、subagent view、command runtime、reference/local/model 状态创建最小 adapter；迁移 `InputEventController` 的具体 modal/context 分支到 resolver，同时保留 composer fallback 和原异步边界。
3. 令 `main.ts` 的 footer `CommandSurface` 选择读取 resolver 投影，并验证 modal 覆盖 main/BTW/subagent owner 后可恢复。
4. 给 render state/hit region 增加 `interactionId`，迁移 pointer controller 到 resolver 提供的 pointer consumer；先接入现有 slash、用户问题、工具审批和文件选择。
5. 添加或更新控制器、pointer、render-state 测试，执行完整 typecheck/test/syntax 检查及交互手工验证。

变更不修改持久化数据或配置，没有运行时迁移。若发现输入行为回归，可整体回退代码；旧 transcript、会话和配置不受影响。

## Open Questions

- 本期不为 command runtime 的通用 `choice` surface 增加新的鼠标行为；但 identity 与 pointer consumer 契约必须允许后续 command handler 显式注册该能力，而无需修改 pointer controller。
