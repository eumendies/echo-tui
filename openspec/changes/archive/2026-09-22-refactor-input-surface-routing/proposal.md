## Why

当前 footer surface 的优先级同时分散在 `main.ts`、`InputEventController` 与 `FooterPointerController`：前者独立选择渲染 modal，后两者分别直接依赖用户问题、工具审批、文件选择和 slash suggestion 等具体 context。每增加一个可交互 surface 都要同步修改多处优先级和语义分发，容易让可见 footer、键盘输入与鼠标命中所有者不一致。

现在应在继续扩展 command choice 和鼠标交互前建立单一、可组合的输入仲裁契约，同时严格保持现有 TUI 交互行为。

## What Changes

- 新增 `InputConsumer`/可选 pointer consumer 契约及 `ActiveInputResolver`，按声明顺序解析当前唯一有效的键盘输入消费者，而不是由多个 controller 分别枚举业务 context。
- 将用户问题、工具审批、文件选择、自动更新及普通 composer 的 slash suggestion 以 adapter 或直接实现的方式接入 resolver；首期保留它们既有键盘、Esc、重绘和决议语义。
- 令 render state 的高优先级 footer surface 与键盘路由读取相同的 modal 解析结果，消除 `main.ts` 与输入控制器维护两份 modal 优先级的情况。
- 将 `FooterPointerController` 收敛为终端鼠标模式、CPR 校准、frame/version 校验与 hit-test 适配器；命中后的语义目标交由当前 pointer consumer 处理，不再直接依赖具体业务 context。
- 为 footer hit region 增加能与当前 consumer 对应的交互身份，防止通用 `choice` 布局或过期 frame 被错误路由。
- 保持 subagent view、BTW、command runtime、引用准备、本地 surface 与 model tuning 的既有生命周期及 owner 模型；本变更不将它们强行纳入单一继承树，也不改变其既有输入优先级。
- 不引入第三方 TUI 库、不切换 alternate screen，且不改变 headless 路径行为。

## Capabilities

### New Capabilities
- `active-input-surface-routing`: 定义 active input consumer 的统一解析、键盘/鼠标转交、渲染投影一致性以及既有输入优先级保持规则。

### Modified Capabilities
- `app-module-organization`: 明确输入事件优先级与高优先级 footer surface 的选择必须由共享解析边界提供，避免 `main.ts` 与多个 controller 重复维护具体 surface 顺序。
- `terminal-mouse-list-interaction`: 明确版本化 hit region 应携带交互消费者身份，pointer 层只做终端协议与命中校验，并将语义路由交给当前匹配的消费者。

## Impact

- 主要影响 `src/app/main.ts`、`src/app/input-event-controller.ts`、`src/app/footer-pointer-controller.ts`、modal state context、slash suggestion 接入点，以及 `src/types/render.ts` 的临时 hit-region 模型。
- 可能新增一个位于 `src/app/` 的粗粒度输入仲裁模块及相应纯函数/控制器测试；现有 `CommandRuntime`、BTW 和 subagent view 仅通过稳定 port 保持兼容。
- 不改变 provider、MCP、transcript、会话持久化、CLI 或公开配置格式。
