## 1. Theme 配置基础

- [x] 1.1 新增 TUI theme 类型、`DEFAULT_TUI_THEME` 和 footer semantic token，默认值映射当前 footer palette 与 256 色背景。
- [x] 1.2 新增 `~/.echo/theme.json` 默认路径解析和可选读取函数，缺失、不可读、JSON 无效时返回默认 theme。
- [x] 1.3 实现 theme color 解析，支持 hex、RGB tuple 和 `{ "ansi256": number }`，并对局部无效 token 回退默认值。
- [x] 1.4 增加 theme 配置单元测试，覆盖缺失文件、无效 JSON、局部覆盖、局部无效回退和默认值保持。

## 2. Render State 注入

- [x] 2.1 在 app 装配根创建时读取 theme，和 syntax highlight 一样只读取一次。
- [x] 2.2 将 theme 加入 `AppContext`、`RenderContext`、`RenderState` 或等价 footer render options。
- [x] 2.3 确保 footer 局部 redraw、streaming pending render 和 destructive resize replay 使用同一个 render theme。
- [x] 2.4 增加 app/render context 测试，验证 render state 暴露默认 theme 和注入 theme。

## 3. Footer Helper 主题化

- [x] 3.1 改造 `src/render/footer/colors.ts`，让前景色、背景色、focus bar、active background、code background/foreground 从 theme token 渲染。
- [x] 3.2 保留默认 theme 下现有 footer ANSI 输出语义，尤其是 RGB foreground、active 256 background 和 code 256 foreground/background。
- [x] 3.3 用语义 token 替换 footer helper 的 cyan 命名依赖，避免新增外观命名作为长期 API。

## 4. Footer Surface 接入

- [x] 4.1 迁移普通 composer、status line 和 slash suggestion，使边框、placeholder、状态段、mode marker、context usage 和 active suggestion 使用 theme。
- [x] 4.2 迁移通用 command surfaces、choice surface 和 user-question surface，使标题、焦点条、active 背景、code-like 内容和弱化文案使用 theme。
- [x] 4.3 迁移 config、mcp、skills、resume、file picker、scale 和 context footer surface，使共享视觉元素使用 theme token。
- [x] 4.4 迁移 diff footer surface，使面板 chrome、文件列表、统计、gutter、added/removed 行背景使用 theme 或默认 theme token。
- [x] 4.5 用 `rg` 清理 footer 范围内残留的硬编码 `FOOTER_COLORS`、`FOOTER_STYLES` 或直接 `ansi.cyan/green/red/gray` 颜色调用；保留非 footer 范围不迁移。

## 5. 测试和文档

- [x] 5.1 更新 footer 渲染测试，验证默认 theme 下现有关键输出不变。
- [x] 5.2 增加自定义 theme override 测试，至少覆盖 composer/status line、active row、skills/config 或 choice surface、scale/context、diff surface。
- [x] 5.3 增加无效 theme 不写 transcript error、不影响 LLM 配置读取的测试。
- [x] 5.4 更新 `docs/README.md`，说明 `~/.echo/theme.json` 路径、示例格式、支持的 token、局部回退和当前仅 footer 生效。
- [x] 5.5 更新 `docs/tui-architecture.md`，记录 theme 读取时机、render state 注入方式和 footer-only 范围。

## 6. 内置 Theme JSON

- [x] 6.1 新增 `src/config/themes/` 内置 theme JSON，至少包含 `default` 和两个可测试的备选 theme。
- [x] 6.2 将默认 theme 固定为代码内常量，避免默认启动路径读取内置 `default.json`。
- [x] 6.3 新增内置 theme 列举和按 id 读取 API，供后续 `/theme` 命令复用。
- [x] 6.4 将内置 theme JSON 复制到 `dist/src/config/themes/`，确保 npm package 安装后可读取。
- [x] 6.5 增加单元测试和 package/build 测试，覆盖内置 theme 列举、代码默认值与默认 JSON 对齐、无效 id 和构建资产存在。
- [x] 6.6 更新文档和 OpenSpec，说明内置 theme JSON、代码默认 theme 来源和后续 `/theme` 切换入口。

## 7. 验证

- [x] 7.1 运行 `npm run typecheck`。
- [x] 7.2 运行 `npm test`。
- [x] 7.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 7.4 手动运行 `npm start`，验证默认 theme 与自定义 `theme.json` 下的 composer/status line、slash suggestions、主要 command surfaces、diff surface、resize 和退出清理。（本次手动覆盖默认 theme 启动、slash suggestions、`/help` command surface 和 `Ctrl+C` 退出；自定义 theme、diff 和 resize 由自动渲染测试覆盖。）
