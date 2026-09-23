## Context

现有 SGR 鼠标输入在 `FooterPointerController` 中完成 CPR 校准、当前 frame 命中和 consumer identity 校验；`ActiveInputResolver` 将命中的语义 target 交给当前最高优先级的 pointer consumer。slash suggestion、用户问题、工具审批与 file picker 已各自提供 adapter。`CommandRuntime` 目前只将键盘 `InputEvent` 转发给 active command handler，`command-session` 也没有 pointer adapter；大多数 command renderer 因而不输出可执行 hit region。

`/model`、`/mode` 的通用 `select` 与 `/resume`、`/copy`、`/diff` 都有稳定的键盘焦点、完整数据索引和窗口化可见行，适合首批扩展。鼠标功能仍由 `ui.mouseInteractionEnabled`、TTY 边界和当前可见 surface 共同门控；鼠标报告会影响部分终端的原生滚动，不能将此能力变成默认路径。

## Goals / Non-Goals

**Goals:**

- 为明确支持的 active command session 建立语义 pointer 路由，而不让终端协议层识别 command 名或业务状态。
- 使通用 `select`、`/resume`、`/copy`、`/diff` 的实际可见列表行支持 hover 与左键操作，并与各自已有键盘语义一致。
- 保证高度裁剪、窗口化、frame 变化、CPR 失配、consumer 切换、非 TTY、headless 和关闭“UI 鼠标交互”时安全降级到键盘路径。
- 让 handler 的异步 pointer 操作复用 command runtime 的 session 更新与重绘生命周期，避免 Promise 泄漏到 `FooterPointerController`。

**Non-Goals:**

- 不支持 `/effort` scale、auto-update、confirm、`/config`、`/mcp`、`/hooks`、`/agents`、`/skills`、`/memory`、model tuning 或只读信息 surface。
- 不支持鼠标滚轮滚动、点击文本光标定位、拖选文本、右键或中键操作。
- 不改变 UI 鼠标交互默认关闭、SGR/CPR 协议、terminal scrollback 取舍或 keyboard fallback。
- 不把 command-specific switch、session 恢复、剪贴板写入或 diff 业务逻辑加入 command runtime 或 pointer controller。

## Decisions

### 1. 使用 command 语义 target，而不是复用坐标或合成键盘事件

renderer 为每个实际可见行输出带完整列表绝对索引和控制种类的 command 语义 target，例如通用 select 选项、resume 会话、copy 消息和 diff 文件。`FooterPointerController` 继续只把 target 与 hover/activate 阶段转交；handler 必须按其当前 session data 验证 target 的 kind、索引和可操作性。

不采用把鼠标坐标或 renderer 行号传给 handler：窗口化、宽度和 footer 高度会使这些值不稳定。不采用“转换为若干 MOVE_* 再 SUBMIT”策略：它会依赖当前焦点、重复触发异步预览，并无法表达 `/copy` 的 Space 切换或 `/diff` 的仅选择语义。

### 2. CommandRuntime 提供可选 pointer dispatch，但不解释业务 action

`CommandHandler` 增加可选的 pointer 处理契约；`CommandRuntime` 仅在 active handler 声明该契约时暴露 `hasPointerHandler()` 与 `handlePointer()`。它将当前 session、语义 target 和 activate 阶段转发给 handler，并沿用键盘事件路径的“session 改变后普通重绘、异步完成后再次检查重绘”规则。`ActiveInputResolver` 的 `command-session` adapter 仅在该能力存在时成为 pointer consumer。

不采用在 `main.ts` 根据 command name 分发：这会破坏 command runtime 的会话所有权和 `CommandHost` facade 边界。不让每个 renderer 直接调用 handler：renderer 必须保持纯投影，且不能持有 host 或 session 可变状态。

### 3. 只投影当前可见、可操作的精确区域

通用 select 的 option 行、resume/copy/diff 双栏中的左侧列表条目分别生成 hit region；region 使用完整列表的绝对索引。`more` 行、边框、标题、空白行、右侧预览/detail、已裁剪行和没有有效数据的 surface 不生成 region。双栏 region 的列范围只覆盖左侧列表，避免点击预览正文意外改变选择。

不采用整张卡片可点击：它会在预览阅读、长文本或窄终端时产生不可预测的激活行为，也无法满足命中区域仅对应当前可见语义项的约束。

### 4. hover 与点击严格复用每个 surface 的已有语义

- `/model`、`/mode` 的通用 `select`：hover 设置目标选项为焦点；左键以该选项执行现有确认语义。
- `/resume`：hover 切换左栏焦点、重置/加载相应预览；左键恢复命中会话，等同先聚焦再按 Enter。
- `/copy`：hover 选择左栏消息并回到 list focus；左键切换命中消息的选择状态，等同先聚焦再按 Space，不触发剪贴板写入。
- `/diff`：hover 或左键选择左栏文件并重置 detail scroll；左键不关闭面板，因为该 surface 的 Enter 是关闭而非文件主操作。

用户已选择高风险确认类后续若接入则点击等同 Enter；但本变更不投影 confirm surface，避免把该策略混入首批命令列表范围。

### 5. 保持单一的 capability gate 与协议层职责

`main.ts` 仍只在 `ui.mouseInteractionEnabled` 为 true 且 resolver 返回 pointer consumer 时传递 `footerInteractionId`。renderer 可以计算候选区域，但没有该 identity 时最终 layout 不得有可执行 region，pointer controller 也不得启用 SGR/CPR。`FooterPointerController` 不新增 command handler 引用、业务分支或异步等待逻辑。

不采用向 `FooterPointerController` 注入 command runtime 或配置读取 callback：这会使协议层同时拥有 policy 与业务路由来源，破坏现有 identity/frame 信任边界。

## Risks / Trade-offs

- [左键 `/resume` 会立即切换会话] → 仅将实际可见的左栏会话行设为命中区域；该行为与用户选择的“点击等同 Enter”一致，并保留 Esc/键盘路径。
- [命令 handler 存在异步操作] → runtime 负责附加完成后的重绘与错误隔离；pointer controller 仍只执行同步协议路由，不持有 Promise。
- [command session 身份在不同命令间相同] → 每次 session/surface 更新均产生新 frame；handler 还需验证当前 surface/session data 是否匹配 target，旧 frame/CPR 继续失效。
- [双栏布局与窗口化的行列计算容易偏移] → renderer 以已生成的可见行数组建立 region，并为窄宽、高度裁剪和 `more` 行添加纯函数测试。
- [启用鼠标仍可能影响宿主滚动] → 保持默认关闭且不处理 wheel；用户可随时关闭“UI 鼠标交互”恢复终端原生行为。

## Migration Plan

1. 增加 optional handler/runtime pointer 契约，不实现该契约的 command 保持键盘专用。
2. 依次接入 select、resume、copy、diff renderer 与 handler，并以各 surface 的现有输入测试作为语义基线。
3. 覆盖开启/关闭设置、owner/consumer 切换、resize/CPR、窗口化和 headless/非 TTY 回归。
4. 若出现终端兼容问题，可移除某个 handler 的 pointer 声明；该 surface 会自动停止输出可执行 identity 并恢复键盘路径，不影响其他已接入 surface。

## Open Questions

- 无。首批 surface、滚轮范围和点击语义已确定；confirm 与复杂表单留给后续独立变更。
