## Why

当前 footer 视觉已经集中到共享 cyan palette，但 palette 仍硬编码在渲染层，用户无法按终端背景、个人偏好或高对比需求调整。将 footer 颜色接入独立 theme 配置，可以在不改变命令行为和 transcript 语义的前提下，先把最集中的 UI 区域主题化。

## What Changes

- 新增用户级 `theme.json` 文件作为 TUI theme 配置入口，和现有 `~/.echo/config.json` 分离。
- 新增默认 footer theme，缺失配置时保持当前 cyan 视觉不变。
- 将 footer 共享 palette 从硬编码 RGB 常量迁移为语义化 theme token，例如 accent、accentStrong、frame、muted、success、warning、danger、activeBackground、codeBackground、codeForeground。
- 本版本只要求 footer 接入 theme，包括普通 composer/status line、slash suggestion、command surfaces、choice、file picker、resume、config、mcp、skills、scale、context 和 diff footer surface。
- theme 配置解析失败、局部字段无效或字段缺失时回退默认值，不写 transcript error，也不阻断聊天能力。
- 不改变 syntax highlight 配置、LLM 配置、命令交互语义、持久化 transcript 或 provider 请求。

## Capabilities

### New Capabilities
- `footer-theme-config`: 定义独立 theme 配置文件、默认 theme、footer semantic color token、配置容错和 footer 接入范围。

### Modified Capabilities
- `command-surface-ui-language`: 将固定 cyan palette 要求调整为默认 cyan 的 semantic footer theme palette，并要求 command surfaces 继续共享同一套 theme token。

## Impact

- 影响配置读取：新增 theme 配置读取入口，路径独立于 `~/.echo/config.json`。
- 影响渲染状态：app 创建时读取 theme，并通过 render state 或等价注入方式传给 footer renderer。
- 影响 footer 渲染：`src/render/footer/colors.ts` 及各 footer surface 需要从 theme token 取色。
- 影响测试：需要覆盖默认 theme 不改变既有 ANSI 输出、theme override 生效、无效配置回退、footer 各主要 surface 使用 theme token。
- 影响文档：更新用户文档和架构文档，说明 `theme.json` 路径、格式和当前仅 footer 生效的范围。
