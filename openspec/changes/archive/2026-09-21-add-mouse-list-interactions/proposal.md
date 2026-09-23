## Why

现有 Echo TUI 的列表型交互完全依赖键盘方向键和确认键。支持终端鼠标悬停与点击可缩短 slash 命令补全、用户问题、工具审批和文件选择等高频流程的操作路径，同时保持键盘作为完整且可靠的后备交互方式。

## What Changes

- 在交互式 TTY 中按需启用并在退出时恢复 SGR 鼠标报告模式；非 TTY 与不支持终端保持原有行为。
- 将 SGR 鼠标报告纳入跨 stdin chunk 的输入解析，区分移动、按下和释放事件，且不得把不完整或未知报告写入 composer。
- 为 footer 布局提供由渲染器生成的命中区域（hit map），将终端绝对鼠标坐标映射到当前可见的列表项，而非由输入层猜测渲染行号。
- 第一阶段为 slash 命令建议、`ask_user_questions` choice surface、工具审批 choice surface 和 `@` 文件选择器提供 hover 聚焦与点击操作。
- hover 仅改变焦点；点击保留各 surface 原有业务语义：单选确认、复选切换、目录浏览与 mention 插入分别由所属 context 决定。
- 对不支持鼠标坐标定位或终端报告的场景安全降级为既有键盘交互，不改变 transcript、工具审批安全边界或 composer 文本。

## Capabilities

### New Capabilities
- `terminal-mouse-list-interaction`: 终端鼠标协议生命周期、输入解析、footer 命中测试和第一阶段列表 UI 的 hover/click 行为。

### Modified Capabilities

- 无。

## Impact

- 受影响模块：`src/terminal/ansi.ts`、`src/terminal/tty.ts`、`src/input/key-parser.ts`、`src/types/input.ts`、`src/app/input-event-controller.ts`、`src/render/footer.ts`、相关 footer surface renderer，以及 slash suggestion、用户问题、工具审批和文件选择 context。
- 需要扩展 `FooterLayout` 或等价渲染结果以表达临时命中区域；该元数据不得进入 transcript 或持久化会话。
- 不增加运行时依赖，不切换 alternate screen，不改变 headless `--once` 路径。
