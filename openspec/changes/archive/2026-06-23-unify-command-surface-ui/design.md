## Context

footer command surface 目前经历了多轮演进：早期 `info/select/checkbox/confirm` 仍使用 `ansi.cyan`、`›` 和 `[x]/[ ]`；较新的 `file_picker`、`config`、`mcp`、`skills` 已形成 `▌` 焦点条、cyan RGB palette、active 背景和 `●/○` 的视觉语言；`resume` 则在 RGB 面板中继续使用 `▸/·` 和 inverse。用户在同一 footer 区域频繁切换这些 surface 时，会感知到颜色、焦点和 marker 规则不一致。

本变更不改变 command runtime 或输入语义，只把已经在项目中占主导的视觉语言抽象并推广到所有 command surfaces。

## Goals / Non-Goals

**Goals:**
- 建立共享 footer theme，消除各 surface 重复定义的 cyan palette 和 active 背景。
- 统一焦点行：使用项目现有粗竖条 `▌` 表示焦点，配合统一 active 背景和 cyan bright 文本。
- 统一 marker：使用 `●/○` 表达 enabled/disabled、checked/unchecked 等有 toggle/boolean 语义的状态；普通单选列表只用 `▌` 表达当前焦点，不强行添加 `●/○`。
- 统一 footer 文案语言：默认提示、空状态和说明使用中文为主，按键名、命令名、路径、协议名和模型名保留英文。
- 保持所有渲染行遵守 safe render width 和现有 footer height budget。

**Non-Goals:**
- 不重做 command surface 布局结构，例如不把所有 surface 改成同一种 card。
- 不改变 `/resume`、`/config`、`/mcp`、`/skills`、choice、file picker 的事件处理、状态数据或业务语义。
- 不统一 transcript 区域、Markdown 渲染、tool call/result 渲染的颜色体系。
- 不引入主题配置、用户自定义配色或第三方 TUI framework。

## Decisions

### 1. 在 `src/render/footer/colors.ts` 中集中定义 footer theme

将 `colors.ts` 从工具函数扩展为共享主题模块，导出：
- `FOOTER_COLORS.cyanDeep/cyan/cyanBright/frame/muted/text/green/amber/danger/violet/free`
- `FOOTER_STYLES.activeBackground256`
- 通用 `rgbText`、`mixRgb` 保留不变

优先让 renderer 直接引用共享常量，避免一次引入过厚的抽象层。只有被多处重复使用且语义稳定的行级样式，再考虑增加 helper，例如 `renderFocusBar()` 或 `activeBackground()`。

**Alternatives considered:**
- 每个 surface 保留本地常量但改成同值：短期可行，但无法防止后续继续分叉。
- 引入完整 theme class 或 renderer context：当前项目没有动态主题需求，过度设计。

### 2. 焦点条统一为现有粗竖条 `▌`

项目多数新 surface 已使用 `▌` 作为焦点条。统一时应修正 `resume` 的 `▸`、通用 select 的 `›` 和 header inverse，保持用户已经看到的粗竖条视觉。

有 toggle 状态的 active row 推荐形态：

```text
▌ ● 当前项
  ○ 其他项
```

没有 toggle 语义的普通 select 推荐形态：

```text
▌ 当前项
  其他项
```

其中 `▌` 只表示焦点，`●/○` 只表示 toggle/boolean 或调用方已有明确 marker 语义的状态。active row 背景统一使用 `ansi.background256(23, ...)`，前景文本使用共享 `cyanBright`，焦点条使用共享 `cyan`。

**Alternatives considered:**
- 使用细 `│`：与当前项目已形成的视觉不一致，且用户明确指出“竖条”指已有粗竖条。
- 仅用背景不显示焦点条：窄屏和低对比终端下焦点可见性较弱。

### 3. marker 统一但不强加到无 toggle 语义的 select

对于启用、checked、已选择文件等有明确状态语义的内容，统一使用 `●/○`。普通 select、resume session 列表、slash suggestion 等只是“当前焦点在哪一行”的场景，不强行添加 `●/○`。不可选文件、纯分隔、错误提示等不参与二元选择的内容，可以继续用 dim 文本或 `-`，避免强行把不可交互状态伪装成可选状态。

重点迁移对象：
- 通用 checkbox：`[x]/[ ]` → `●/○`
- 通用 select：`›` → active row 的 `▌`，不新增 `●/○`
- resume session：`▸/·` → active row 的 `▌`，不新增 `●/○`

### 4. 文案统一采用“中文句子 + 保留技术名词”

默认 copy 统一为中文，例如 `press any key to close` 改为 `按任意键关闭`，`type to filter` 改为 `输入以过滤`。但 `Enter`、`Esc`、`Tab`、`MCP`、`API key`、`Base URL`、`provider`、模型 id、路径和 slash command 名称保留英文，避免不自然翻译。

为了降低风险，文案迁移优先覆盖 footer renderer 默认文案和常见 command hint；运行时错误、provider 返回内容和模型/工具协议字段不在第一优先级。

### 5. 测试聚焦可见语义而非具体 ANSI 字节

颜色和背景会集中迁移，测试应尽量验证：
- 去 ANSI 后的 marker 和文案
- active row 包含焦点条语义
- 所有行 display width 不超过 safe render width
- surface 仍在高度预算内窗口化

仅对共享 helper 或关键视觉样式保留少量 ANSI 断言，避免后续 theme 微调导致大量脆弱测试失败。

## Risks / Trade-offs

- [Risk] 大量 renderer 同时改动，容易引入宽度计算回退或 ANSI 截断问题 → Mitigation：每个 surface 保留现有布局函数，只替换颜色/marker/文案，并补充或更新宽度约束测试。
- [Risk] 普通 select 强行添加 `●/○` 会制造不存在的 toggle 语义 → Mitigation：规范中明确 `▌` 表示焦点，`●/○` 只用于 toggle/boolean 或调用方已有明确状态 marker 的场景。
- [Risk] 统一中文文案可能影响已有测试断言 → Mitigation：更新测试断言为用户可见文案的新规范，并避免对非用户可见内部错误过度迁移。
- [Risk] 共享 theme 迁移范围过大 → Mitigation：先建立 theme 并迁移最不一致的 surface，再迁移已接近统一的新 surface；保持每步可验证。
