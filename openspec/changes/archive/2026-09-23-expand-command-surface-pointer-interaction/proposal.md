## Why

终端鼠标交互目前只覆盖 slash suggestion、用户问题、工具审批和文件选择器。`/model`、`/mode` 等选择器以及 `/resume`、`/copy`、`/diff` 等列表面板虽然已有键盘焦点与窗口化投影，却不能通过鼠标操作，导致同类列表在交互体验上不一致。

现有 `FooterPointerController`、版本化 hit region 与 `ActiveInputResolver` 已把终端协议和业务路由分离；现在可以在不让协议层识别具体命令的前提下，为 command session 建立受控的语义 pointer 分发路径。

## What Changes

- 为 command runtime 与 command handler 增加可选的语义 pointer 分发入口，使当前 active command session 可以在明确声明支持时成为 pointer consumer。
- 为 `/model`、`/mode` 的通用 `select` surface 与 `/resume`、`/copy`、`/diff` 的当前可见列表项生成带稳定 command-session 身份的临时 hit region。
- 定义 hover 只更新焦点；左键点击按各 surface 既有主键盘操作执行：`select` 确认选择，`/resume` 恢复命中会话，`/copy` 切换命中消息选择，`/diff` 选择命中文件。
- 保持 `FooterPointerController` 只负责 SGR/CPR、frame 校验、命中与当前 consumer 路由；不让它依赖 command 名或业务状态。
- 保持“UI 鼠标交互”默认关闭、TTY/headless 边界、键盘 fallback、窗口化裁剪与终端原生滚动取舍。首期不支持滚轮滚动、click-to-caret、auto-update、确认卡片及 `/config`、MCP、Hooks、Agents、Skills、Memory 等复杂表单。

## Capabilities

### New Capabilities

- `command-surface-pointer-interaction`: 定义 command session 的语义 pointer 路由，以及 select、resume、copy、diff surface 的 hover/click 行为与可见 hit region 约束。

### Modified Capabilities

- `terminal-mouse-list-interaction`: 将鼠标报告和 hit region 生命周期扩展到明确支持 pointer 的 command session surface，同时保持协议层无业务耦合。
- `command-host-runtime`: 使 command runtime 在不解释具体业务 effect 的前提下，向当前 command handler 转发语义 pointer target 并统一处理其渲染生命周期。

## Impact

- `src/types/render.ts` 的 footer 语义 target、hit region owner 和 pointer consumer 类型。
- `src/app/active-input-resolver.ts`、`src/app/command/command-runtime.ts` 与 command handler 协议。
- `src/render/footer/command-surfaces.ts`、`resume-surface.ts`、`copy-surface.ts`、`diff-surface.ts` 的可见列表命中投影。
- `/model`、`/mode`、`/resume`、`/copy`、`/diff` handler 的语义 pointer 适配与测试；`/effort` 的 scale surface 保持键盘专用。
- pointer controller、command runtime、footer renderer 与 app 集成测试；无需新增依赖或改变 headless CLI。
