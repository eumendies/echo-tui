## MODIFIED Requirements

### Requirement: 鼠标能力按交互列表生命周期启停
系统 SHALL 仅在 `ui.mouseInteractionEnabled` 为 `true`、stdin 与 stdout 均为 TTY、且当前可见 footer 为明确支持鼠标的交互列表时启用终端鼠标报告。支持的交互列表包括 slash suggestion、用户问题 choice、工具审批 choice、file picker，以及 handler 显式声明 pointer 能力的通用 `select`、`/resume`、`/copy` 与 `/diff` command session surface。系统 SHALL 使用支持移动、按下和释放坐标的 SGR 扩展报告格式，并 SHALL 在设置关闭、列表关闭、owner 切换、应用退出、信号清理或终端初始化失败时禁用此前启用的鼠标模式。系统 SHALL NOT 在 headless `--once`、非 TTY 路径或用户关闭 UI 鼠标交互时启用该模式。

#### Scenario: 开启 UI 鼠标交互后打开支持的交互列表
- **WHEN** `ui.mouseInteractionEnabled` 为 true
- **AND** slash suggestion、用户问题 choice、工具审批 choice、file picker，或已声明 pointer 能力的 select、resume、copy、diff command session surface 成为当前可见且接收输入的 surface
- **AND** stdin 与 stdout 均为 TTY
- **THEN** 系统 SHALL 启用 SGR 鼠标报告以接收移动、左键按下和左键释放坐标
- **THEN** 系统 SHALL 保持既有 raw mode 与 bracketed paste 行为

#### Scenario: 关闭 UI 鼠标交互时保持终端原生滚动路径
- **WHEN** `ui.mouseInteractionEnabled` 为 false
- **AND** 当前可见 footer 是支持鼠标的交互列表
- **THEN** 系统 SHALL NOT 输出鼠标模式 ANSI 序列或请求用于鼠标命中的 CPR
- **THEN** 系统 SHALL 保持键盘交互，并将终端原生鼠标与 scrollback 行为留给宿主终端

#### Scenario: 关闭或替换列表时恢复鼠标模式
- **WHEN** 已启用鼠标的当前支持列表关闭、被更高优先级 surface 替换或应用退出
- **THEN** 系统 SHALL 禁用其先前启用的鼠标报告
- **THEN** 后续普通 composer 输入 SHALL NOT 因该列表残留终端鼠标模式而接收鼠标报告

#### Scenario: 非交互终端保持既有行为
- **WHEN** stdin 或 stdout 不是 TTY，或运行 headless `--once`
- **THEN** 系统 SHALL NOT 输出鼠标模式 ANSI 序列
- **THEN** 系统 SHALL 保持既有非交互输入、输出和退出语义
