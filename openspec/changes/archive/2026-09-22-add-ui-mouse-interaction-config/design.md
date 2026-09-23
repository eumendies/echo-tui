## Context

当前 `FooterPointerController` 会在 slash suggestion、用户问题、工具审批或文件选择器成为可操作 pointer consumer 时启用 `?1003h`/`?1006h` 终端鼠标报告。该协议为 hover 和点击提供坐标，但会让部分终端、tmux 或用户配置将滚轮报告交给 stdin，而不是滚动原生 scrollback。

现有常规设置已经通过 `AppSettings`、`UserConfigContext`、`/config` 常规草稿和 app settings watcher 支持字段级默认值、原子保存和运行时刷新。鼠标命中区域则已由 `footerInteractionId` 与当前 resolver pointer consumer 身份绑定，可在不改变业务 adapter 的情况下整体禁止投影。

## Goals / Non-Goals

**Goals:**

- 用 `ui.mouseInteractionEnabled` 提供持久化、可编辑的“UI 鼠标交互”开关。
- 缺失或非法值默认关闭，令默认 TUI 路径不启用鼠标报告并保留终端原生滚动体验。
- 开关保存或 watcher 热更新后，在当前 TUI 实例立即、无残留地启停鼠标报告、CPR 和可执行 hit region。
- 保持既有键盘路由、pointer consumer 语义、非 TTY 和 headless 边界。

**Non-Goals:**

- 不实现滚轮滚动 transcript、模拟终端 scrollback 或为不同终端/tmux 提供修饰键绕过策略。
- 不新增点击模式、仅 hover 模式或按 surface 单独配置的多个鼠标策略。
- 不改变鼠标已启用时的 hover、点击、frame identity、CPR 校准或业务 adapter 语义。

## Decisions

### 1. 使用 `ui.mouseInteractionEnabled`，界面名称固定为“UI 鼠标交互”

该字段属于整体 TUI 交互策略，而非某一 footer 组件；因此使用现有 `ui` 命名空间和 boolean camelCase 名称。`/config` 常规页显示“UI 鼠标交互”，配置文件缺失、非 boolean 或不可读取时归一化为 `false`。

替代方案是 `footerMouseEnabled`。它会错误暗示能力只影响 footer 的视觉区域，且不表达终端鼠标报告对全局 scrollback 的影响，因此不采用。

### 2. 在 render 投影处门控，而不是让 pointer controller 了解配置

`main.ts` 从当前 app settings 决定是否把 resolver pointer consumer 的 identity 写入 `RenderState.footerInteractionId`。关闭时 renderer 不输出最终 hit region；`FooterPointerController.update()` 因没有匹配区域而关闭鼠标报告、清空 frame、取消或忽略 CPR 校准。这样 controller 继续只负责终端协议和坐标路由，不依赖用户配置或业务状态。

替代方案是在 `FooterPointerController` 注入配置 callback。该方案会把配置策略带入协议层，也会在 renderer 仍暴露可执行区域时产生两个不一致的能力来源，因此不采用。

### 3. 设置变化使用普通 footer 重绘即时生效

`AppContext.applyAppSettingsSnapshot()` 将“UI 鼠标交互”变化显式分类；`main.ts` 的既有 settings watcher 对该分类执行普通 `render()`，不做 transcript destructive replay。重绘后的 snapshot 是启停鼠标报告的唯一触发点：关闭时同步移除 hit map 并停止报告，开启时仅在当前确有可操作 pointer surface 时开始报告和 CPR 校准。

替代方案是要求重启。现有配置系统已支持即时常规设置刷新，且重启会使用户难以在滚轮受阻时立刻恢复 scrollback，因此不采用。

### 4. 默认关闭，并将其作为有意的迁移行为

鼠标报告会改变终端最基础的滚动手势；缺失字段选择 `false`，让旧配置和新安装默认保持键盘与原生 scrollback。希望使用 hover/点击的用户通过 `/config` 显式开启，或写入 `ui.mouseInteractionEnabled: true`。

替代方案是默认开启以保持最近鼠标功能的行为。它无法解决本次用户可控性与 scrollback 冲突，因此不采用。

## Risks / Trade-offs

- [默认关闭改变已启用鼠标交互用户的体验] → 在 `/config` 提供可发现的“UI 鼠标交互”行，并在配置文档中说明 `ui.mouseInteractionEnabled: true` 的手动迁移方式。
- [外部 watcher 在 pointer surface 活跃时关闭开关] → 普通 render 必须产生空 hit map，使 pointer controller 立即禁用报告并失效化旧 frame/CPR；迟到事件继续按既有 identity/version 规则忽略。
- [不同终端对鼠标模式和 scrollback 的表现不同] → 开关只控制是否发送既有 ANSI 鼠标序列，不承诺启用后的滚轮行为，也不尝试合成终端历史滚动。
- [配置草稿尚未保存时误改变运行时] → 仅保存成功安装的新 `UserConfigSnapshot` 或 watcher 的新 snapshot 可更新运行时；编辑草稿始终隔离。

## Migration Plan

1. 发布后，缺失 `ui.mouseInteractionEnabled` 的配置归一化为 `false`，不要求修改配置文件。
2. 用户可在 `/config` → “常规” → “UI 鼠标交互”保存开启，或手动设置 `ui.mouseInteractionEnabled: true`。
3. 若需要回退版本，旧版本会忽略未知 `ui.mouseInteractionEnabled` 字段；删除该字段也会恢复新版本的默认关闭行为。

## Open Questions

- 无。开关字段、界面名称和默认值已确定；终端的修饰键滚轮绕过属于明确排除范围。
