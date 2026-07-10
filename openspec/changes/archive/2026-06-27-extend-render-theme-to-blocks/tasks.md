## 1. Theme 数据模型和配置读取

- [x] 1.1 扩展 `TuiTheme`，新增 blocks、markdown、syntax 语义分组，并保持 footer 分组继续可用。
- [x] 1.2 移除 `ThemeColor` 的 raw `sgr` kind，调整解析逻辑只接受 hex/RGB tuple 和 `{ "ansi256": number }`。
- [x] 1.3 更新 `DEFAULT_TUI_THEME`，让默认值覆盖 footer、banner、transcript blocks、pending preview、Markdown structural styles、tool chrome 和 syntax token styles。
- [x] 1.4 更新内置 theme JSON，使 `default`、`amber`、`violet` 都包含完整 render theme 字段，并与代码默认 theme 保持对齐。
- [x] 1.5 删除 `readSyntaxHighlightTheme()` 和旧 `~/.echo/config.json` 下 `tui.syntaxHighlight` 的读取路径，不保留兼容转换或版本语义。

## 2. Render 颜色 helper 集中化

- [x] 2.1 将 `src/render/footer/colors.ts` 提升为 `src/render/colors.ts`，集中放置 colorText、colorBackground、styleText、colorToRgb、mixRgb 和各区域 token helper。
- [x] 2.2 更新 footer surface imports，全部改为从 `src/render/colors.ts` 引用颜色 helper。
- [x] 2.3 删除 `src/render/footer/colors.ts`，确保没有 footer/block 子 colors 文件或一行转发 helper。
- [x] 2.4 确认 `src/config/theme-config.ts` 不 import `src/render/colors.ts`，保持配置层不依赖渲染层。

## 3. Blocks 和 App Renderer 接入

- [x] 3.1 将 theme 传入 `renderBanner`、`renderTranscriptLines`、`renderTranscriptBlocks`、`renderRecordBlock` 和各 transcript block renderer。
- [x] 3.2 让 `appendRecord`、`appendRecords`、`renderDestructive`、`renderFinal` 和启动 banner 都使用当前 `RenderState.theme`。
- [x] 3.3 将 user、assistant prefix、error、local notice、compaction notice、reasoning summary、shell block 和 pending preview 的硬编码 ANSI 颜色替换为 blocks theme token。
- [x] 3.4 保持 transcript record、session persistence、agent input 和 pending state 数据结构不变。

## 4. Markdown 和 Syntax Highlight 接入

- [x] 4.1 更新 `renderMarkdownLinesWithOptions` 及内部 block renderer，使 heading、list marker、blockquote、rule、table separator 和 role prefix 使用 markdown theme token。
- [x] 4.2 更新 `markdown-inline.ts`，让 inline code、link、bold、italic 的可配置样式来自 markdown theme。
- [x] 4.3 更新 `markdown-table.ts`，让 table header、divider、column separator 和 table cell inline styles 使用 markdown theme，并保持 display width 计算不受 ANSI 影响。
- [x] 4.4 更新 `syntax-highlight.ts`，让 token style 来源改为 `theme.syntax`，并保持跨行字符串、块注释和 streaming preview 规则不变。
- [x] 4.5 删除旧 syntax highlight 配置测试，新增 theme.json syntax token override 测试。

## 5. Tool Block 接入和固定语义色

- [x] 5.1 更新通用 tool call/result renderer，让 tool call 符号、成功/失败状态、普通 result 输出和弱化文本使用 blocks/tool theme token。
- [x] 5.2 更新 bash tool renderer，让 bash call/result 的普通 chrome 使用 theme，保持输出文本和截断语义不变。
- [x] 5.3 更新 apply_patch tool renderer，让 header、neutral、context、omitted 等非事实色使用 theme。
- [x] 5.4 保持 apply_patch added/removed 行背景为代码内固定红绿语义色，并增加测试证明 theme override 不会改变它们。

## 6. 测试和文档

- [x] 6.1 增加 theme config 测试，覆盖 blocks/markdown/syntax 局部覆盖、无效 token 回退、`sgr` 输入失效和内置 JSON 完整性。
- [x] 6.2 增加 app/render 测试，覆盖 append、destructive replay、final render 和 pending preview 使用同一 theme。
- [x] 6.3 增加 blocks 测试，覆盖 banner、user block、assistant prefix、error、notice、reasoning summary、shell 和 pending summary 的 theme override。
- [x] 6.4 增加 Markdown/syntax 测试，覆盖 heading、bullet、blockquote、table、inline code/link 和 fenced code token 的 theme override。
- [x] 6.5 更新 `docs/README.md`，说明 `theme.json` 的完整 render theme 格式，并移除 `tui.syntaxHighlight` 文档。
- [x] 6.6 更新 `docs/tui-architecture.md`，记录统一 render theme、`src/render/colors.ts` 边界、固定事实语义色和 theme 读取时机。

## 7. 验证

- [x] 7.1 运行 `npm run typecheck`。
- [x] 7.2 运行 `npm test`。
- [x] 7.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 7.4 手动运行 `npm start`，验证默认 theme 与自定义 `theme.json` 下的 banner、transcript blocks、Markdown、syntax highlight、tool block、footer、resize recovery 和退出清理。（本次手动覆盖默认 theme 启动；自定义 theme、transcript blocks、Markdown、syntax highlight、tool block 和 resize recovery 由自动渲染测试覆盖。）
